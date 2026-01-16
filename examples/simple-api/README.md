# Simple API Example

The simplest possible dotdo example - just export DOFull.

## Usage

```bash
npm run dev    # Local development
npm run deploy # Deploy to Cloudflare
```

## API

All CRUD operations are built-in:

```bash
# Create
curl -X POST http://localhost:8787/api/items \
  -H "Content-Type: application/json" \
  -d '{"$type": "Customer", "name": "Alice"}'

# List
curl http://localhost:8787/Customer

# Health check
curl http://localhost:8787/health
```

## RPC Client

```typescript
import { createRPCClient } from '@dotdo/core'

const api = createRPCClient({ target: 'http://localhost:8787' })
const customers = await api.Customer.list()
```
