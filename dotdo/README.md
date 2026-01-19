# dotdo

THE runtime for Digital Objects. Business-as-Code. Services-as-Software.

## Installation

```bash
npm install dotdo
```

## Quick Start

```typescript
import { DO, createContext } from 'dotdo'

export class MyDO extends DO {
  constructor(state, env) {
    super(state, env)

    this.$.on.Customer.signup(async (event) => {
      await this.$.send({ type: 'welcome', to: event.email })
    })
  }
}
```

## CLI

```bash
dotdo init      # Create new project
dotdo dev       # Start dev server
dotdo deploy    # Deploy to workers.do
dotdo login     # Login via oauth.do
```

## Packages

| Package | Description |
|---------|-------------|
| @dotdo/do | THE Durable Object for Digital Objects |
| @dotdo/db | Abstract storage layer |
| @dotdo/ai | AI routing and template literals |
| @dotdo/auth | Hono auth middleware |
| @dotdo/rpc | Cap'n Web RPC |
| @dotdo/mcp | MCP server with 3 tools |
| @dotdo/api | Self-describing Hono API |

## Status

See beads issues do-7rf.9.* for implementation progress.
