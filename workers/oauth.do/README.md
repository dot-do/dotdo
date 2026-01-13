# oauth.do

OAuth 2.0 Authorization Server platform service for dotdo.

Enables dotdo apps to implement "Sign in with [YourApp]" functionality by acting as an OAuth 2.0 / OpenID Connect provider.

## Features

- **RFC 6749** - OAuth 2.0 Authorization Framework
- **RFC 7636** - PKCE Extension (required for public clients)
- **RFC 7009** - Token Revocation
- **RFC 7662** - Token Introspection
- **RFC 7591** - Dynamic Client Registration
- **OpenID Connect Core 1.0** - ID tokens, UserInfo endpoint, Discovery

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/.well-known/openid-configuration` | OpenID Connect Discovery document |
| `/.well-known/jwks.json` | JSON Web Key Set for token verification |
| `/authorize` | Authorization endpoint (start OAuth flow) |
| `/token` | Token endpoint (exchange code for tokens) |
| `/userinfo` | UserInfo endpoint (get user claims) |
| `/introspect` | Token introspection (RFC 7662) |
| `/revoke` | Token revocation (RFC 7009) |
| `/register` | Dynamic client registration (RFC 7591) |

## Usage

### Basic Setup

```typescript
import { createOAuthServer } from 'dotdo/oauth'

const server = createOAuthServer({
  issuer: 'https://oauth.myapp.do',
  signingKey: env.OAUTH_SIGNING_KEY,
  accessTokenTtl: 3600,
  refreshTokenTtl: 86400 * 30,
})

export default {
  fetch: server.fetch
}
```

### With Durable Objects

```typescript
import { OAuthWorker, OAuthClientDO, OAuthTokenDO } from 'dotdo/oauth'

export { OAuthClientDO, OAuthTokenDO }
export default OAuthWorker()
```

## Client Registration

### Dynamic Registration

```bash
curl -X POST https://oauth.myapp.do/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My App",
    "redirect_uris": ["https://myapp.com/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "scope": "openid profile email"
  }'
```

Response:
```json
{
  "client_id": "cl_abc123",
  "client_secret": "cs_xyz789",
  "client_name": "My App",
  "redirect_uris": ["https://myapp.com/callback"]
}
```

## OAuth Flow

### 1. Authorization Request

```
GET /authorize?
  response_type=code&
  client_id=cl_abc123&
  redirect_uri=https://myapp.com/callback&
  scope=openid+profile&
  state=random-csrf-token&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256
```

### 2. Token Exchange

```bash
curl -X POST https://oauth.myapp.do/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'client_id:client_secret' | base64)" \
  -d "grant_type=authorization_code" \
  -d "code=AUTH_CODE" \
  -d "redirect_uri=https://myapp.com/callback" \
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

Response:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "eyJ...",
  "id_token": "eyJ...",
  "scope": "openid profile"
}
```

### 3. UserInfo Request

```bash
curl https://oauth.myapp.do/userinfo \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Response:
```json
{
  "sub": "user-123",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "email_verified": true,
  "picture": "https://example.com/avatar.jpg"
}
```

## Security

- PKCE is **required** for public clients (no client secret)
- Authorization codes are one-time use
- Code reuse triggers automatic token revocation (attack detection)
- All tokens support revocation and introspection
- Client secrets are stored hashed
- JWT signing uses RS256 (RSA + SHA-256)

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `issuer` | string | required | OAuth issuer URL |
| `signingKey` | string | required | Key for JWT signing |
| `accessTokenTtl` | number | 3600 | Access token TTL in seconds |
| `refreshTokenTtl` | number | 2592000 | Refresh token TTL (30 days) |
| `authorizationCodeTtl` | number | 600 | Auth code TTL (10 minutes) |
| `scopes` | string[] | openid,profile,email,offline_access | Supported scopes |
| `enforceHttps` | boolean | false | Require HTTPS redirect URIs |

## Durable Objects

### OAuthClientDO

Manages OAuth client registrations per client_id:
- Client credentials (id, secret hash)
- Redirect URIs
- Allowed scopes and grant types
- Rate limiting per client

### OAuthTokenDO

Manages tokens per user:client pair:
- Authorization codes
- Access tokens
- Refresh tokens
- User consents
- Bulk revocation

## Testing

```bash
npx vitest run workers/oauth.do/tests/oauth.test.ts
```
