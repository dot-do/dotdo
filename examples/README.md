# dotdo Examples

Choose your API style by picking the right worker:

## Quick Start

```bash
# Create a new project
mkdir my-app && cd my-app
npm init -y
npm install dotdo

# Copy an example
cp -r node_modules/dotdo/examples/hateoas-api/* .

# Start developing
npm run dev
```

## API Styles

### 1. HATEOAS (apis.vin-style)

```jsonc
// wrangler.jsonc
{
  "main": "node_modules/dotdo/workers/hateoas.ts"
}
```

Response:
```json
{
  "api": { "$context": "https://my-app.example.com.ai" },
  "links": { "self": "/", "home": "/" },
  "discover": { "customers": "/Customer/", "orders": "/Order/" },
  "actions": { "rpc": { "method": "POST", "href": "/rpc" } },
  "data": { ... }
}
```

### 2. JSON:API (jsonapi.org)

```jsonc
// wrangler.jsonc
{
  "main": "node_modules/dotdo/workers/jsonapi.ts"
}
```

Response:
```json
{
  "jsonapi": { "version": "1.1" },
  "data": {
    "type": "Customer",
    "id": "alice",
    "attributes": { "name": "Alice" },
    "relationships": { "orders": { "links": { "related": "/orders" } } }
  },
  "links": { "self": "/Customer/alice" }
}
```

### 3. Simple JSON

```jsonc
// wrangler.jsonc
{
  "main": "node_modules/dotdo/workers/simple.ts"
}
```

Response:
```json
{ "$type": "Customer", "$id": "alice", "name": "Alice" }
```

### 4. Custom (Mix & Match)

```typescript
// src/index.ts
import { Hono } from 'hono'
import hateoasApp from 'dotdo/workers/hateoas'
import jsonapiApp from 'dotdo/workers/jsonapi'

const app = new Hono()
app.route('/api', hateoasApp)     // Public API
app.route('/mobile', jsonapiApp)  // Mobile clients

export default app
```

## Examples

| Example | API Style | Description |
|---------|-----------|-------------|
| [hateoas-api](./hateoas-api) | HATEOAS | Self-documenting clickable API |
| [jsonapi](./jsonapi) | JSON:API | Ember/React-friendly standard |
| [simple-api](./simple-api) | Simple | Minimal overhead |
| [custom-do](./custom-do) | Custom | Full control with Hono |

## DO Classes

```typescript
import { DO } from 'dotdo'           // Standard (~15KB)
import { DO } from 'dotdo/tiny'      // Minimal (~5KB)
import { Worker } from 'dotdo/worker' // With scheduling
import { Agent } from 'dotdo/agent'   // With AI tools
```
