# Authentication Patterns Example

A comprehensive authentication system demonstrating JWT tokens, sessions, API keys, password management, and 2FA using dotdo Durable Objects.

## Features

This example demonstrates:

- **JWT Authentication**: Access tokens and refresh tokens
- **Session Management**: Track and revoke active sessions
- **API Keys**: Programmatic access with scoped permissions
- **Password Security**: Secure hashing, reset flows
- **Two-Factor Auth (2FA)**: TOTP-based verification
- **Rate Limiting**: Protect against brute force attacks
- **Security Logging**: Audit trail of security events
- **Multi-tenancy**: Isolated auth per tenant

## Key dotdo Concepts

### Middleware-based Authentication

```typescript
// Define auth middleware
const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header required' }, 401)
  }

  const token = authHeader.slice(7)
  const payload = await verifyJWT(token, this.jwtSecret)

  if (!payload || payload.type !== 'access') {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  // Attach user info to context
  c.set('userId', payload.sub)
  c.set('userRole', payload.role)

  await next()
}

// Apply to protected routes
app.get('/auth/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  // ...
})
```

### Secure Token Generation

```typescript
// Generate cryptographically secure IDs
function generateId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Password hashing with salt
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('')

  const encoder = new TextEncoder()
  const passwordWithSalt = encoder.encode(saltHex + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordWithSalt)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${saltHex}:${hashHex}`
}
```

### Security Event Logging

```typescript
// Log important security events
await this.things.create({
  $type: 'SecurityEvent',
  userId,
  eventType: 'login',
  ipAddress: req.header('CF-Connecting-IP'),
  userAgent: req.header('User-Agent'),
  createdAt: new Date().toISOString(),
})

// Query security events
const events = await this.things.list({ type: 'SecurityEvent' })
```

### Scheduled Cleanup

```typescript
// Clean up expired sessions daily
this.$.every.day.at3am(async () => {
  const sessions = await this.things.list({ type: 'Session' })
  const now = new Date().toISOString()

  for (const session of sessions) {
    if (session.expiresAt < now) {
      await this.things.delete(session.$id)
    }
  }
})
```

## API Endpoints

### Public Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create new account |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset password with token |
| POST | `/auth/verify-api-key` | Verify an API key |

### Protected Endpoints (Auth Required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/me` | Get current user profile |
| POST | `/auth/logout` | Logout current session |
| POST | `/auth/logout-all` | Logout all sessions |
| POST | `/auth/change-password` | Change password |
| GET | `/auth/sessions` | List active sessions |
| DELETE | `/auth/sessions/:id` | Revoke specific session |
| GET | `/auth/api-keys` | List API keys |
| POST | `/auth/api-keys` | Create new API key |
| DELETE | `/auth/api-keys/:id` | Revoke API key |
| POST | `/auth/2fa/setup` | Setup 2FA |
| POST | `/auth/2fa/enable` | Enable 2FA |
| POST | `/auth/2fa/disable` | Disable 2FA |

### Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/security-events` | View security audit log |

## Usage Examples

### Register a New User

```bash
curl -X POST http://localhost:8792/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123!",
    "name": "Alice Smith"
  }'
```

Response:
```json
{
  "user": {
    "$id": "user-abc123",
    "email": "alice@example.com",
    "name": "Alice Smith",
    "role": "user",
    "emailVerified": false,
    "twoFactorEnabled": false
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900
}
```

### Login

```bash
curl -X POST http://localhost:8792/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123!"
  }'
```

### Login with 2FA

```bash
curl -X POST http://localhost:8792/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123!",
    "twoFactorCode": "123456"
  }'
```

### Access Protected Resources

```bash
curl http://localhost:8792/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

### Refresh Token

```bash
curl -X POST http://localhost:8792/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }'
```

### Create API Key

```bash
curl -X POST http://localhost:8792/auth/api-keys \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI/CD Pipeline",
    "permissions": ["read:tasks", "write:tasks"],
    "expiresIn": 90
  }'
```

Response:
```json
{
  "id": "key-xyz789",
  "name": "CI/CD Pipeline",
  "key": "dk_a1b2c3d4e5f6...",
  "permissions": ["read:tasks", "write:tasks"],
  "expiresAt": "2024-04-15T00:00:00Z"
}
```

### Use API Key

```bash
curl http://localhost:8792/auth/verify-api-key \
  -H "X-API-Key: dk_a1b2c3d4e5f6..."
```

### Setup 2FA

```bash
# Step 1: Get setup info
curl -X POST http://localhost:8792/auth/2fa/setup \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."

# Response includes QR code URL and backup codes

# Step 2: Verify and enable
curl -X POST http://localhost:8792/auth/2fa/enable \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{"code": "123456"}'
```

### Password Reset Flow

```bash
# Step 1: Request reset
curl -X POST http://localhost:8792/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'

# Step 2: Reset with token (from email)
curl -X POST http://localhost:8792/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "abc123def456...",
    "newPassword": "NewSecurePass456!"
  }'
```

### List Active Sessions

```bash
curl http://localhost:8792/auth/sessions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

Response:
```json
{
  "data": [
    {
      "id": "session-123",
      "userAgent": "Mozilla/5.0...",
      "ipAddress": "192.168.1.1",
      "createdAt": "2024-01-15T10:00:00Z",
      "lastActiveAt": "2024-01-15T14:30:00Z"
    }
  ]
}
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
examples/auth-patterns/
  AuthDO.ts           # Main Durable Object implementation
  types.ts            # TypeScript type definitions
  index.ts            # Worker entrypoint
  wrangler.jsonc      # Cloudflare configuration
  package.json        # Package configuration
  README.md           # This file
```

## Architecture

```
HTTP Request with Bearer Token
         |
         v
+---------------------+
|   Worker (index)    |
|   Route by tenant   |
+---------------------+
         |
         v
+---------------------+
|      AuthDO         |
|  - things           |  <-- User, Session, ApiKey, etc.
|  - authMiddleware   |  <-- JWT verification
|  - rate limiting    |  <-- Brute force protection
+---------------------+
         |
         v
+---------------------+
|   SQLite Storage    |
+---------------------+
```

## Security Features

### Password Security

- Minimum 8 characters required
- Salted SHA-256 hashing
- Salt stored with hash

### Token Security

- Short-lived access tokens (15 min)
- Long-lived refresh tokens (7 days)
- Tokens stored server-side for revocation

### Rate Limiting

- 5 failed login attempts before lockout
- 15 minute lockout duration
- Per-IP tracking

### API Key Security

- Keys shown only once at creation
- Hash stored, not plaintext
- Per-key permissions
- Optional expiration
- Usage tracking

### Audit Logging

- All logins/logouts logged
- Failed attempts tracked
- Password changes recorded
- API key lifecycle events
- IP and User-Agent captured

## Production Considerations

- **Use proper crypto**: Replace simplified implementations with jose/bcrypt
- **HTTPS only**: Always use TLS in production
- **Secure cookies**: Store tokens in httpOnly, secure cookies
- **Email verification**: Require email verification before full access
- **Password policies**: Enforce complexity requirements
- **Account lockout**: Implement progressive delays
- **Suspicious activity**: Alert on unusual login patterns
- **Token rotation**: Rotate refresh tokens on use
- **Secrets management**: Use Cloudflare secrets for JWT_SECRET
