# Auth Architecture

The auth system provides federated identity management with better-auth, supporting human users, AI agents, and service accounts across distributed Durable Objects.

## Architecture

```
App → id.org.ai (better-auth OAuth Provider) → WorkOS AuthKit
                      ↓
              Linked Accounts, AI Agents, Vault refs
```

### Design Principles

- **Base DO includes better-auth by default** - Every DO inherits auth capabilities
- **Default: federate to parent DO (id.org.ai)** - Zero-config auth delegation
- **Override: configure own OAuth providers** - Full control when needed
- **WorkOS AuthKit as upstream for human auth** - Enterprise-grade SSO, MFA, directory sync
- **id.org.ai transforms WorkOS users to identity schema** - Unified identity model

## better-auth Plugins Used

| Plugin          | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `oauthProvider` | Makes id.org.ai an OAuth 2.1 provider ("Login with id.org.ai") |
| `oauthProxy`    | Cross-domain auth when child DOs are on different domains      |
| `organization`  | Multi-tenant support with `activeOrganizationId`               |

## Identity Types

| Type      | Description                             |
| --------- | --------------------------------------- |
| `human`   | Real users, OAuth login via WorkOS      |
| `agent`   | AI with scoped capabilities             |
| `service` | Functions, workflows, automated systems |

## Linked Account Types

Linked accounts connect identities to external services with credentials stored in WorkOS Vault.

| Type        | Services                      | Use Case                     |
| ----------- | ----------------------------- | ---------------------------- |
| `auth`      | WorkOS, GitHub, Google        | Identity providers, SSO      |
| `channel`   | Slack, Discord, Teams, Email  | Communication, notifications |
| `ai`        | Anthropic, OpenAI, OpenRouter | AI provider credentials      |
| `finance`   | Stripe                        | Payments, billing            |
| `infra`     | Cloudflare, Vercel, AWS       | Cloud infrastructure         |
| `devtools`  | GitHub, GitLab, Linear        | Code, project management     |
| `workspace` | Notion, Google Workspace      | Productivity tools           |
| `data`      | Databases, analytics          | Data sources                 |
| `customer`  | CRM, support                  | Customer management          |
| `social`    | Social media                  | Social integrations          |
| `custom`    | User-defined                  | Extensible for any service   |

## Configuration Modes

### 1. Federate to Parent (Default)

Zero-configuration - auth delegates to id.org.ai automatically.

```typescript
import { auth } from '@dotdo/auth'

// Uses id.org.ai as OAuth provider
export const { GET, POST } = auth()
```

### 2. Own Providers

Configure your own OAuth providers for full control.

```typescript
import { auth } from '@dotdo/auth'

export const { GET, POST } = auth({
  federation: false,
  providers: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
})
```

### 3. Hybrid

Federate to parent while adding custom providers.

```typescript
import { auth } from '@dotdo/auth'

export const { GET, POST } = auth({
  federation: true, // default
  providers: {
    // Add custom providers alongside federation
    myEnterprise: {
      type: 'oidc',
      issuer: 'https://auth.enterprise.com',
      clientId: env.ENTERPRISE_CLIENT_ID,
      clientSecret: env.ENTERPRISE_CLIENT_SECRET,
    },
  },
})
```

## Auth Middleware Configuration

```typescript
import { auth, type AuthConfig } from '@dotdo/auth'

const config: AuthConfig = {
  // Federation settings
  federation: true, // Delegate to parent DO (default: true)
  federationUrl: 'https://id.org.ai', // Parent OAuth provider URL

  // OAuth provider settings (when federation: false)
  providers: {
    github: { clientId, clientSecret },
    google: { clientId, clientSecret },
    workos: { clientId, clientSecret, connection },
  },

  // better-auth plugin options
  plugins: {
    oauthProvider: {
      enabled: true, // Act as OAuth 2.1 provider
      clients: [], // Registered OAuth clients
    },
    oauthProxy: {
      enabled: true, // Cross-domain auth support
      allowedOrigins: ['*.example.com'],
    },
    organization: {
      enabled: true, // Multi-tenant support
      allowUserToCreateOrganization: true,
    },
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minute cache
    },
  },

  // Identity type restrictions
  allowedIdentityTypes: ['human', 'agent', 'service'],

  // Callbacks
  callbacks: {
    onSessionCreate: async (session, user) => {},
    onSessionDestroy: async (session) => {},
    onLinkAccount: async (user, account) => {},
  },

  // WorkOS Vault integration for token storage
  vault: {
    enabled: true, // Store tokens in WorkOS Vault
    encrypt: true, // Encrypt at rest
  },
}

export const { GET, POST, auth: getSession } = auth(config)
```

## WorkOS Vault Integration

Sensitive credentials and tokens are stored securely in WorkOS Vault.

```typescript
import { vault } from '@dotdo/auth/vault'

// Store linked account credentials
await vault.store({
  userId: user.id,
  accountType: 'ai',
  provider: 'anthropic',
  credentials: {
    apiKey: 'sk-ant-...',
  },
})

// Retrieve credentials (decrypted)
const creds = await vault.get({
  userId: user.id,
  accountType: 'ai',
  provider: 'anthropic',
})

// List all linked accounts for user
const accounts = await vault.list({ userId: user.id })

// Rotate credentials
await vault.rotate({
  userId: user.id,
  accountType: 'ai',
  provider: 'anthropic',
  newCredentials: { apiKey: 'sk-ant-new-...' },
})
```

### Vault Storage Schema

```typescript
interface VaultEntry {
  id: string
  userId: string
  accountType: LinkedAccountType
  provider: string
  credentials: Record<string, unknown> // Encrypted at rest
  metadata: {
    scopes?: string[]
    expiresAt?: Date
    refreshToken?: string // For OAuth tokens
  }
  createdAt: Date
  updatedAt: Date
}
```

## Usage Examples

### Protecting Routes

```typescript
import { auth } from './auth'

export async function onRequest(context) {
  const session = await auth.getSession(context.request)

  if (!session) {
    return Response.redirect('/login')
  }

  // Access user and organization
  const { user, activeOrganizationId } = session
}
```

### Agent Authentication

```typescript
import { auth } from '@dotdo/auth'

// Create agent identity
const agent = await auth.createAgent({
  name: 'my-assistant',
  capabilities: ['read:documents', 'write:messages'],
  ownerId: user.id,
})

// Agent makes authenticated request
const response = await fetch('/api/data', {
  headers: {
    Authorization: `Bearer ${agent.token}`,
  },
})
```

### Cross-Domain Auth with oauthProxy

```typescript
// On app.example.com
import { auth } from '@dotdo/auth'

export const { GET, POST } = auth({
  plugins: {
    oauthProxy: {
      enabled: true,
      upstream: 'https://id.org.ai',
    },
  },
})

// User clicks "Login" on app.example.com
// → Redirected to id.org.ai for auth
// → Redirected back with session cookie
```
