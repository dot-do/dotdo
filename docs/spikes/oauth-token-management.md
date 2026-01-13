# OAuth Token Management in Durable Objects

**Issue:** dotdo-hgb86
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike analyzes OAuth token management patterns for ETL connectors in the Durable Objects model. ETL connectors require OAuth tokens for third-party API access, and tokens expire requiring refresh. The research identifies existing implementations, proposes a unified architecture, and addresses concurrency concerns.

### Key Findings

1. **Existing Infrastructure:** The codebase already has substantial OAuth/token management (OAuthTokenDO, CredentialVault, TokenManager, IntegrationsDO)
2. **Single-Flight Pattern:** Durable Objects provide natural single-writer semantics, solving most concurrency concerns
3. **Recommended Approach:** Extend `CredentialVault` with DO-backed storage for connector credentials

## OAuth2 Token Lifecycle Review

### Token Types and Lifetimes

| Token Type | Typical Lifetime | Purpose |
|------------|------------------|---------|
| Authorization Code | 10 minutes | Initial exchange, one-time use |
| Access Token | 1 hour | API authentication |
| Refresh Token | 30-90 days | Obtain new access tokens |
| ID Token | 1 hour | User identity (OIDC) |

### Token Flow for ETL Connectors

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │────>│ OAuth Flow  │────>│ Store Token │
│   Consent   │     │ (callback)  │     │ in DO       │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               v
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Execute   │<────│ Get Token   │<────│ ETL Sync    │
│   API Call  │     │ (refresh?)  │     │ Triggered   │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Existing Codebase Analysis

### 1. OAuthTokenDO (`workers/oauth.do/objects/OAuthTokenDO.ts`)

Full OAuth server implementation for issuing tokens to dotdo apps:

```typescript
export class OAuthTokenDO implements DurableObject {
  // Stores tokens per user:client pair
  private tokenState: {
    userId: string
    clientId: string
    authCodes: Map<string, AuthorizationCode>
    accessTokens: Map<string, AccessToken>
    refreshTokens: Map<string, RefreshToken>
    consents: UserConsent | null
  }

  // Token rotation with security detection
  async rotateRefreshToken(request: Request): Promise<Response> {
    const oldToken = state.refreshTokens.get(token)
    if (oldToken.revoked || expired) {
      return error('Invalid refresh token')
    }
    // Revoke old, create new
    oldToken.revoked = true
    const newToken = generateRefreshToken()
    state.refreshTokens.set(newToken, { ... })
    return { refresh_token: newToken }
  }
}
```

**Strengths:**
- Complete OAuth2 token lifecycle
- Token rotation support
- Authorization code one-time use enforcement
- Revocation tracking

**Gap:** Designed for dotdo-as-OAuth-provider, not for consuming third-party OAuth tokens.

### 2. CredentialVault (`db/primitives/credential-vault/index.ts`)

Secure credential storage with encryption and auto-refresh:

```typescript
export class CredentialVault extends EventEmitter {
  // AES-256-GCM encrypted storage
  private async encrypt(value: CredentialValue): Promise<{ encryptedValue: string; iv: string }>

  // OAuth2 token auto-refresh
  async store(options: CredentialOptions): Promise<Credential> {
    // Store with rotation policy
    await vault.store({
      name: 'google-oauth',
      type: 'oauth2',
      value: { accessToken, refreshToken, expiresAt },
      rotation: {
        policy: 'auto',
        refreshEndpoint: 'https://oauth2.googleapis.com/token',
        clientId: '...',
        clientSecret: '...',
        refreshBeforeExpiry: 300000, // 5 minutes
      },
    })
  }

  // Automatic refresh with retry
  private async performOAuthRefresh(name: string, raw: RawCredential, token: OAuth2Token): Promise<void> {
    const maxRetries = rotation.maxRetries ?? 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const response = await fetch(rotation.refreshEndpoint!, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken!,
          client_id: rotation.clientId!,
          client_secret: rotation.clientSecret!,
        }),
      })
      // Update stored token
      raw.encryptedValue = await this.encrypt(newToken)
      this.emit('credential:refreshed', { name, previousExpiry, newExpiry })
    }
  }
}
```

**Strengths:**
- Encrypted at rest (AES-256-GCM)
- Auto-refresh with configurable policies
- Retry with exponential backoff
- Version history for audit
- Event emission for monitoring

**Gap:** In-memory Map storage, needs DO-backed persistence.

### 3. TokenManager (`primitives/token-manager/index.ts`)

JWT handling and token pair management:

```typescript
export class TokenManager {
  // Token pair generation
  async createTokenPair(payload: TokenPayload): Promise<TokenPair> {
    const accessToken = await this.createToken(payload)
    const refreshToken = this.refreshStore.generateToken()
    await this.refreshStore.store(refreshToken, payload.sub, { family, expiresAt })
    return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
  }

  // Token refresh with rotation
  async refreshToken(refreshToken: string): Promise<TokenPair | null> {
    const tokenData = await this.refreshStore.get(refreshToken)
    if (!tokenData) return null

    // Detect token reuse attack
    if (tokenData.used) {
      await this.refreshStore.revokeFamily(tokenData.family)
      return null
    }

    await this.refreshStore.markUsed(refreshToken)
    return this.createTokenPair({ sub: tokenData.userId })
  }
}
```

**Strengths:**
- Token family tracking (rotation detection)
- Reuse attack detection
- JWT creation and verification

### 4. IntegrationsDO (`objects/IntegrationsDO.ts`)

Provider registry with OAuth config and SDK creation:

```typescript
export class IntegrationsDO {
  // Provider OAuth configuration
  interface OAuthConfig {
    authUrl: string
    tokenUrl: string
    scopes: string[]
    clientIdEnvVar: string
    clientSecretEnvVar: string
  }

  // Token fetch from Vault
  private async fetchTokenFromVault(linkedAccountId: string): Promise<TokenData | null> {
    const vaultDO = this.env.VAULT_DO
    const stub = vaultDO.get(vaultDO.idFromName(linkedAccountId))
    return stub.fetch(`http://vault/token/${linkedAccountId}`).json()
  }

  // Automatic token refresh
  async createSDK(providerSlug: string, linkedAccountId: string): Promise<SDK> {
    let currentToken = await this.fetchTokenFromVault(linkedAccountId)

    const executeAction = async (action, params) => {
      // Auto-refresh before expired
      if (currentToken.expiresAt < Date.now()) {
        currentToken = await this.refreshTokenInVault(linkedAccountId)
      }
      // Execute API call with fresh token
      return fetch(action.endpoint, {
        headers: { Authorization: `Bearer ${currentToken.accessToken}` }
      })
    }
  }
}
```

**Strengths:**
- Centralized provider configuration
- Token auto-refresh in SDK
- Vault integration pattern

### 5. ConnectorFramework (`db/primitives/connector-framework/index.ts`)

ETL connector lifecycle with OAuth support in config spec:

```typescript
interface OAuth2FlowConfig {
  type: 'oauth2'
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  refreshUrl?: string
  pkceRequired?: boolean
}

interface ConfigSpec {
  authMethods?: AuthMethodConfig[]
}
```

## Proposed Architecture

### ConnectorCredentialDO

A new Durable Object specifically for ETL connector credential management:

```typescript
/**
 * ConnectorCredentialDO - OAuth credential storage for ETL connectors
 *
 * Key design decisions:
 * 1. One DO per linked account (user + provider)
 * 2. Single-writer semantics from DO eliminate most race conditions
 * 3. Encrypted storage with key rotation support
 * 4. Proactive refresh before expiry
 * 5. Refresh lock to prevent thundering herd
 */
export class ConnectorCredentialDO implements DurableObject {
  private state: DurableObjectState
  private refreshInProgress: Promise<void> | null = null

  interface StoredToken {
    accessToken: string       // Encrypted
    refreshToken?: string     // Encrypted
    expiresAt: number         // Unix timestamp
    tokenType: string         // Usually 'Bearer'
    scope?: string            // Granted scopes
    provider: string          // e.g., 'salesforce', 'google'
    refreshConfig: {
      clientId: string
      clientSecret: string    // Encrypted or from env var
      tokenUrl: string
    }
    metadata: {
      linkedAccountId: string
      userId: string
      createdAt: number
      lastRefreshedAt?: number
      refreshCount: number
    }
  }

  /**
   * Get access token, refreshing if necessary
   *
   * This is the primary method connectors call
   */
  async getAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
    const token = await this.state.storage.get<StoredToken>('token')
    if (!token) {
      throw new Error('No token stored')
    }

    const shouldRefresh =
      options?.forceRefresh ||
      token.expiresAt <= Date.now() + REFRESH_BUFFER_MS

    if (shouldRefresh && token.refreshToken) {
      await this.refreshToken()
      const refreshed = await this.state.storage.get<StoredToken>('token')
      return refreshed!.accessToken
    }

    if (token.expiresAt <= Date.now()) {
      throw new Error('Token expired and no refresh token available')
    }

    return token.accessToken
  }

  /**
   * Refresh token with single-flight protection
   *
   * DO's single-writer model ensures only one refresh runs at a time
   * within this DO instance. The refreshInProgress promise handles
   * concurrent requests within the same request context.
   */
  private async refreshToken(): Promise<void> {
    // Single-flight: if refresh is in progress, wait for it
    if (this.refreshInProgress) {
      return this.refreshInProgress
    }

    this.refreshInProgress = this.doRefresh()

    try {
      await this.refreshInProgress
    } finally {
      this.refreshInProgress = null
    }
  }

  private async doRefresh(): Promise<void> {
    const token = await this.state.storage.get<StoredToken>('token')
    if (!token?.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await fetch(token.refreshConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: token.refreshConfig.clientId,
        client_secret: token.refreshConfig.clientSecret,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new TokenRefreshError(error.error, error.error_description)
    }

    const newTokenData = await response.json()

    await this.state.storage.put<StoredToken>('token', {
      ...token,
      accessToken: newTokenData.access_token,
      refreshToken: newTokenData.refresh_token ?? token.refreshToken,
      expiresAt: Date.now() + (newTokenData.expires_in * 1000),
      scope: newTokenData.scope ?? token.scope,
      metadata: {
        ...token.metadata,
        lastRefreshedAt: Date.now(),
        refreshCount: token.metadata.refreshCount + 1,
      },
    })
  }

  /**
   * Store initial token from OAuth callback
   */
  async storeToken(tokenResponse: OAuthTokenResponse, config: RefreshConfig): Promise<void> {
    await this.state.storage.put<StoredToken>('token', {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
      tokenType: tokenResponse.token_type,
      scope: tokenResponse.scope,
      provider: config.provider,
      refreshConfig: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenUrl: config.tokenUrl,
      },
      metadata: {
        linkedAccountId: config.linkedAccountId,
        userId: config.userId,
        createdAt: Date.now(),
        refreshCount: 0,
      },
    })
  }

  /**
   * Revoke token (disconnect account)
   */
  async revokeToken(): Promise<void> {
    const token = await this.state.storage.get<StoredToken>('token')
    if (token?.refreshConfig?.revokeUrl) {
      await fetch(token.refreshConfig.revokeUrl, {
        method: 'POST',
        body: new URLSearchParams({
          token: token.refreshToken ?? token.accessToken,
          client_id: token.refreshConfig.clientId,
          client_secret: token.refreshConfig.clientSecret,
        }),
      })
    }
    await this.state.storage.delete('token')
  }

  // HTTP handler for inter-DO communication
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/token':
        const accessToken = await this.getAccessToken()
        return Response.json({ accessToken })

      case '/token/refresh':
        await this.refreshToken()
        return Response.json({ success: true })

      case '/token/store':
        const body = await request.json()
        await this.storeToken(body.tokenResponse, body.config)
        return Response.json({ success: true })

      case '/token/revoke':
        await this.revokeToken()
        return Response.json({ success: true })

      default:
        return new Response('Not Found', { status: 404 })
    }
  }
}
```

## Concurrency Analysis

### Why DO Single-Writer Model Works

Durable Objects provide **strong consistency guarantees**:

1. **Single-threaded execution:** Only one request executes at a time within a DO
2. **Storage atomicity:** `state.storage.put()` is atomic
3. **Alarm exclusivity:** Alarms don't interrupt running requests

```
Request A ──────▶ getAccessToken() ──▶ needsRefresh? ──▶ refresh() ──▶ return
                                          │
Request B ────────────────────────────────┼────────────▶ [waits] ──▶ return
                                          │
                                   (sequential execution)
```

### Race Condition Scenarios

| Scenario | Without DO | With DO |
|----------|------------|---------|
| Two syncs request token simultaneously | Both might refresh | One refreshes, other waits |
| Refresh while sync in progress | Token might change mid-request | Single-flight pattern |
| Multiple connectors for same account | Distributed refresh race | Centralized in single DO |

### Remaining Concurrency Concerns

1. **Cross-DO coordination:** When multiple DOs need the same credential
   - Solution: Route through single ConnectorCredentialDO per linked account

2. **Long-running syncs:** Token might expire during multi-hour ETL job
   - Solution: Request fresh token at each batch boundary

3. **Provider rate limits on token refresh:**
   - Solution: Add jitter to refresh buffer, track last refresh time

## Token Refresh Strategies

### 1. Proactive Refresh (Recommended)

Refresh before expiry to avoid failed requests:

```typescript
const REFRESH_BUFFER_MS = 5 * 60 * 1000  // 5 minutes before expiry

async getAccessToken(): Promise<string> {
  const token = await this.state.storage.get('token')
  const shouldRefresh = token.expiresAt <= Date.now() + REFRESH_BUFFER_MS

  if (shouldRefresh && token.refreshToken) {
    await this.refreshToken()
  }
  return token.accessToken
}
```

**Pros:**
- API calls always use valid tokens
- No retry needed due to expired tokens

**Cons:**
- Slightly more refresh operations

### 2. Reactive Refresh

Refresh only after 401 error:

```typescript
async executeWithRetry(fn: () => Promise<Response>): Promise<Response> {
  let response = await fn()

  if (response.status === 401) {
    await this.refreshToken()
    response = await fn()
  }

  return response
}
```

**Pros:**
- Fewer refresh operations
- Works even if clock skew

**Cons:**
- First request fails, added latency
- Some APIs don't return proper 401

### 3. Background Refresh (Alarm-based)

Use DO alarm to refresh before expiry:

```typescript
async storeToken(token: OAuthToken): Promise<void> {
  await this.state.storage.put('token', token)

  // Schedule refresh 5 minutes before expiry
  const refreshAt = new Date(token.expiresAt - 5 * 60 * 1000)
  await this.state.storage.setAlarm(refreshAt)
}

async alarm(): Promise<void> {
  await this.refreshToken()
}
```

**Pros:**
- Token always ready
- No latency on sync requests

**Cons:**
- DO incurs cost even when idle
- Provider might rate limit frequent refreshes

### Recommendation: Proactive + Background Hybrid

```typescript
async storeToken(token: OAuthToken): Promise<void> {
  await this.state.storage.put('token', token)

  // For long-lived tokens (> 1 hour), schedule background refresh
  const timeToExpiry = token.expiresAt - Date.now()
  if (timeToExpiry > 60 * 60 * 1000) {
    const refreshAt = new Date(token.expiresAt - 10 * 60 * 1000)
    await this.state.storage.setAlarm(refreshAt)
  }
}

async getAccessToken(): Promise<string> {
  const token = await this.state.storage.get('token')

  // Proactive refresh for short-lived tokens or if alarm missed
  if (token.expiresAt <= Date.now() + 5 * 60 * 1000) {
    await this.refreshToken()
  }

  return token.accessToken
}

async alarm(): Promise<void> {
  try {
    await this.refreshToken()
  } catch (error) {
    // Log but don't crash - proactive refresh will handle
    console.error('Background refresh failed:', error)
  }
}
```

## Security Considerations

### 1. Token Encryption at Rest

While DO storage is encrypted by Cloudflare, add application-level encryption for defense in depth:

```typescript
import { CredentialVault } from '../db/primitives/credential-vault'

class ConnectorCredentialDO {
  private vault: CredentialVault

  constructor(state: DurableObjectState, env: Env) {
    this.vault = new CredentialVault({
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,  // 32-byte key
    })
  }

  async storeToken(token: OAuthToken): Promise<void> {
    // Vault encrypts before storage
    await this.vault.store({
      name: 'oauth-token',
      type: 'oauth2',
      value: token,
    })
  }
}
```

### 2. Client Secret Management

Options for storing client secrets:

1. **Environment variables** (recommended for platform-managed secrets)
   ```typescript
   clientSecret: this.env.SALESFORCE_CLIENT_SECRET
   ```

2. **Encrypted in DO storage** (for user-provided OAuth apps)
   ```typescript
   await this.vault.store({
     name: 'client-secret',
     type: 'secret',
     value: clientSecret,
   })
   ```

3. **External secret manager** (WorkOS Vault, HashiCorp Vault)
   ```typescript
   const secret = await this.env.WORKOS_VAULT.getSecret('salesforce-client-secret')
   ```

### 3. Audit Logging

Track token operations for security auditing:

```typescript
interface TokenAuditLog {
  timestamp: number
  operation: 'store' | 'refresh' | 'revoke' | 'access'
  linkedAccountId: string
  userId: string
  provider: string
  success: boolean
  error?: string
  metadata?: {
    refreshCount?: number
    expiresAt?: number
    ipAddress?: string
  }
}
```

### 4. Token Scope Validation

Verify requested scopes match stored scopes:

```typescript
async getAccessToken(requiredScopes?: string[]): Promise<string> {
  const token = await this.state.storage.get('token')

  if (requiredScopes) {
    const grantedScopes = new Set(token.scope?.split(' ') ?? [])
    const hasAllScopes = requiredScopes.every(s => grantedScopes.has(s))

    if (!hasAllScopes) {
      throw new InsufficientScopesError(requiredScopes, Array.from(grantedScopes))
    }
  }

  return token.accessToken
}
```

## Integration with Connector Framework

### Updated Connector Config Spec

Extend `ConfigSpec` to support OAuth credential reference:

```typescript
interface ConnectorConfig {
  // Static credentials (API keys, etc.)
  apiKey?: string

  // OAuth credential reference
  oauth?: {
    linkedAccountId: string  // References ConnectorCredentialDO
    requiredScopes?: string[]
  }
}
```

### Connector Token Access

```typescript
export function createSourceConnector(def: SourceConnectorDef): SourceConnector {
  return {
    async read(config, catalog, state): AsyncGenerator<AirbyteMessage> {
      // Resolve OAuth token if configured
      let accessToken: string | undefined
      if (config.oauth) {
        const credentialDO = env.CONNECTOR_CREDENTIALS.get(
          env.CONNECTOR_CREDENTIALS.idFromName(config.oauth.linkedAccountId)
        )
        accessToken = await credentialDO.fetch('/token').then(r => r.json()).then(d => d.accessToken)
      }

      // Use token in API calls
      for await (const record of fetchRecords(accessToken)) {
        yield { type: 'RECORD', record }
      }
    }
  }
}
```

## Testing Strategy

### 1. Unit Tests

```typescript
describe('ConnectorCredentialDO', () => {
  it('should refresh token when expired', async () => {
    const do = await createTestDO()

    // Store token that expires soon
    await do.storeToken({
      access_token: 'old-token',
      refresh_token: 'refresh-123',
      expires_in: 60,  // 1 minute
    }, config)

    // Wait and verify refresh
    await clock.tick(2 * 60 * 1000)
    const token = await do.getAccessToken()
    expect(token).not.toBe('old-token')
  })

  it('should handle concurrent token requests', async () => {
    const do = await createTestDO()

    // Simulate concurrent requests
    const [token1, token2] = await Promise.all([
      do.getAccessToken(),
      do.getAccessToken(),
    ])

    expect(token1).toBe(token2)
    expect(refreshCallCount).toBe(1)  // Only one refresh
  })
})
```

### 2. Integration Tests

```typescript
describe('ConnectorCredentialDO Integration', () => {
  it('should work with Salesforce OAuth', async () => {
    // Mock Salesforce token endpoint
    fetchMock.post('https://login.salesforce.com/services/oauth2/token', {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    })

    const do = await createTestDO()
    await do.storeToken(initialToken, salesforceConfig)

    // Trigger refresh
    await do.refreshToken()

    const token = await do.getAccessToken()
    expect(token).toBe('new-access-token')
  })
})
```

## Recommendations

### 1. Implementation Priority

| Priority | Task | Effort |
|----------|------|--------|
| P0 | Create ConnectorCredentialDO | 3-5 days |
| P0 | Integrate with IntegrationsDO | 2 days |
| P1 | Add encryption via CredentialVault | 1-2 days |
| P1 | Background refresh via alarms | 1 day |
| P2 | Audit logging | 1 day |
| P2 | Scope validation | 1 day |

### 2. Architecture Decision

**Recommended:** Create `ConnectorCredentialDO` as primary token store

**Rationale:**
- Single DO per linked account provides natural concurrency control
- Integrates well with existing `IntegrationsDO` pattern
- Can leverage `CredentialVault` for encryption
- Aligns with existing OAuth patterns in codebase

### 3. Migration Path

1. Start with ConnectorCredentialDO for new connectors
2. Update IntegrationsDO to use ConnectorCredentialDO
3. Migrate existing token storage (if any) to new DO
4. Add encryption and audit logging

## References

### Existing Implementations
- `workers/oauth.do/objects/OAuthTokenDO.ts` - OAuth token storage DO
- `db/primitives/credential-vault/index.ts` - Encrypted credential storage
- `primitives/token-manager/index.ts` - JWT token management
- `objects/IntegrationsDO.ts` - Provider registry and SDK creation
- `compat/auth/shared/oauth.ts` - OAuth manager with PKCE support

### OAuth Specifications
- RFC 6749 - OAuth 2.0 Framework
- RFC 6750 - Bearer Token Usage
- RFC 7636 - PKCE Extension
- RFC 7009 - Token Revocation
- RFC 7662 - Token Introspection

### Related Spikes
- `docs/spikes/cross-do-join-latency.md` - Cross-DO communication patterns
