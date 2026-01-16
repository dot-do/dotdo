# Auth API Example

DOFull with WorkOS authentication via oauth.do.

- Read operations: Public (no auth)
- Write operations: Require valid token

## Usage

```bash
npm run dev    # Local development
npm run deploy # Deploy to Cloudflare
```

## API

```bash
# Public read (no auth)
curl http://localhost:8787/Customer

# Protected write (requires token)
curl -X POST http://localhost:8787/api/items \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"$type": "Customer", "name": "Alice"}'
```

## Production Auth

Set WorkOS credentials:

```bash
wrangler secret put WORKOS_CLIENT_ID
```

Then use `oauth.do/node`:

```typescript
import { ensureLoggedIn } from 'oauth.do/node'
```
