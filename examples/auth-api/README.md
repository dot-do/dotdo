# Auth API Example

A complete JWT authentication API demonstrating secure user management with Cloudflare Durable Objects.

## Features

- **User Registration**: Email/password registration with validation
- **JWT Authentication**: HS256-signed tokens using jose library
- **Password Hashing**: Secure password storage with Web Crypto API
- **Protected Routes**: Middleware-based route protection
- **Per-User Storage**: Each user has their own Durable Object

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# The API will be available at http://localhost:8787
```

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API discovery |
| `POST` | `/auth/register` | Register a new user |
| `POST` | `/auth/login` | Login and get JWT token |

### Protected Endpoints (require `Authorization: Bearer <token>`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/auth/me` | Get current user profile |
| `PATCH` | `/auth/me` | Update current user profile |
| `POST` | `/auth/refresh` | Refresh JWT token |

## Usage Examples

### Register a New User

```bash
curl -X POST http://localhost:8787/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "securepassword123",
    "name": "Alice Smith"
  }'
```

Response:
```json
{
  "user": {
    "id": "usr_m5abc123_xyz789",
    "email": "alice@example.com",
    "name": "Alice Smith",
    "createdAt": 1705123456789,
    "updatedAt": 1705123456789
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

### Login

```bash
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "securepassword123"
  }'
```

### Get Current User (Protected)

```bash
curl http://localhost:8787/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Update Profile (Protected)

```bash
curl -X PATCH http://localhost:8787/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Johnson"}'
```

### Change Password (Protected)

```bash
curl -X PATCH http://localhost:8787/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"password": "newSecurePassword456"}'
```

### Refresh Token (Protected)

```bash
curl -X POST http://localhost:8787/auth/refresh \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Architecture

```
Worker (Stateless)
    |
    +-> JWT Verification
    |
    +-> UserDO (Durable Object per email)
            |
            +-> SQLite Storage
            +-> Password Hashing (Web Crypto)
```

- **Worker**: Handles JWT operations and routes to UserDO
- **UserDO**: One DO per user email, stores credentials and profile
- **JWT**: 24-hour tokens signed with HS256

## Security Features

### Password Hashing

Passwords are hashed using:
1. Random 16-byte salt generation
2. SHA-256 hashing via Web Crypto API
3. Constant-time comparison for verification

### JWT Tokens

Tokens include:
- User ID, email, and name in payload
- 24-hour expiration
- Issuer claim for validation
- HS256 signature

## Configuration

Set the JWT secret in production:

```bash
# Set secret via wrangler
wrangler secret put JWT_SECRET

# Or use .dev.vars for local development
echo 'JWT_SECRET=your-super-secret-key' > .dev.vars
```

## Error Handling

All errors return consistent JSON:

```json
{
  "error": "Error message here"
}
```

Common status codes:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid credentials or token)
- `409` - Conflict (user already exists)
- `500` - Internal Server Error

## Key Patterns Demonstrated

1. **JWT with jose**: Modern JWT library that works in Workers
2. **Web Crypto API**: Native password hashing without external deps
3. **Auth Middleware**: Reusable middleware pattern with Hono
4. **Per-User DO**: Email-based namespace for user isolation
5. **Secure Credential Storage**: Salt + hash, never store plaintext

## Deployment

```bash
# Set production secret
wrangler secret put JWT_SECRET

# Deploy to Cloudflare Workers
npm run deploy
```

## Project Structure

```
auth-api/
├── src/
│   ├── index.ts      # Worker + JWT + routes
│   └── UserDO.ts     # User Durable Object
├── package.json
├── tsconfig.json
├── wrangler.jsonc    # Cloudflare config
└── README.md
```

## Related Examples

- [todo-app](../todo-app) - Simple CRUD example
- [realtime-chat](../realtime-chat) - Real-time WebSocket chat
