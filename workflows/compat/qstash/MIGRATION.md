# Migrating from QStash to @dotdo/qstash

## Quick Start

1. **Change imports:**
```typescript
// Before
import { Client } from '@upstash/qstash'

// After
import { Client } from '@dotdo/qstash'
```

2. **Update configuration:**
```typescript
// Before (requires token)
const client = new Client({ token: process.env.QSTASH_TOKEN })

// After (token optional in compat mode)
const client = new Client({
  token: 'optional',  // Can be any string
  // Optional: configure storage for persistence
  state: env.QSTASH_DO_STATE,  // Durable Object state
})
```

3. **Your existing code works unchanged:**
```typescript
await client.publishJSON({
  url: 'https://my-api.com/webhook',
  body: { hello: 'world' },
})
```

## What's Different

### Cost Model
- **QStash**: Pay per message ($0.50/100k after free tier)
- **dotdo**: Included in Cloudflare billing (~$0.04/1k executions)

### Delivery
- **QStash**: Managed infrastructure, auto-retry
- **dotdo**: Runs in your Workers, you control retry logic

### Features Not Implemented
- `getMessage()` - Use DO storage directly
- API management endpoints

## Testing Your Migration

1. Install dotdo compat layer:
```bash
npm install @dotdo/qstash
```

2. Run in development mode to verify:
```typescript
const client = new Client({ token: 'dev-mode' })
// Messages will be processed locally
```

3. Deploy to Cloudflare Workers for production testing
