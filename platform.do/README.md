# platform.do

Platform SDK for dotdo - provides a typed `$` context for accessing platform services.

[![npm version](https://img.shields.io/npm/v/platform.do.svg)](https://www.npmjs.com/package/platform.do)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
# npm
npm install platform.do

# pnpm
pnpm add platform.do

# yarn
yarn add platform.do
```

## Overview

`platform.do` provides a typed `$` proxy for accessing dotdo platform services:

- **Functions** - Serverless function management
- **Workflows** - Durable workflow execution
- **Agents** - AI agent invocation
- **Database** - SQL database operations

It also re-exports everything from `sdk.do` for convenience.

## Quick Start

```typescript
import { $ } from 'platform.do'

// Create and invoke a function
const fn = await $.Functions.create({
  name: 'hello',
  code: 'export default (input) => `Hello, ${input.name}!`'
})
const result = await $.Functions.invoke('hello', { name: 'World' })

// Run a workflow
const run = await $.Workflows.run('onboarding', { userId: '123' })

// Invoke an AI agent
const response = await $.Agents.invoke('assistant', 'Hello!')

// Query the database
const { rows } = await $.Database.query('SELECT * FROM users WHERE id = ?', [1])
```

## Platform Services

### Functions

Create and invoke serverless functions:

```typescript
import { $ } from 'platform.do'

// Create a function
const fn = await $.Functions.create({
  name: 'greet',
  description: 'Greeting function',
  code: 'export default ({ name }) => `Hello, ${name}!`',
  runtime: 'javascript'
})

// Invoke the function
const greeting = await $.Functions.invoke('greet', { name: 'Alice' })
// => "Hello, Alice!"

// List all functions
const functions = await $.Functions.list()
```

### Workflows

Define and execute durable workflows:

```typescript
import { $ } from 'platform.do'

// Create a workflow
const workflow = await $.Workflows.create({
  name: 'user-onboarding',
  description: 'New user onboarding process',
  steps: [
    { id: 'welcome', type: 'function', config: { fn: 'sendWelcome' }, next: 'verify' },
    { id: 'verify', type: 'wait', config: { event: 'email.verified' }, next: 'setup' },
    { id: 'setup', type: 'function', config: { fn: 'setupAccount' } }
  ]
})

// Run the workflow
const run = await $.Workflows.run('user-onboarding', {
  userId: 'user-123',
  email: 'alice@example.com'
})

// Check run status
const status = await $.Workflows.get(run.$id)
console.log(status.status) // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
```

### Agents

Create and interact with AI agents:

```typescript
import { $ } from 'platform.do'

// Create an agent
const agent = await $.Agents.create({
  name: 'support-assistant',
  description: 'Customer support agent',
  systemPrompt: 'You are a helpful customer support assistant.',
  model: 'claude-3',
  tools: ['search', 'createTicket']
})

// Invoke the agent
const response = await $.Agents.invoke('support-assistant', 'How do I reset my password?')
```

### Database

Execute SQL queries and statements:

```typescript
import { $ } from 'platform.do'

// Query data
const { rows, rowCount } = await $.Database.query<{ id: string; name: string }>(
  'SELECT id, name FROM users WHERE active = ?',
  [true]
)

// Execute statements
const { rowsAffected, lastInsertId } = await $.Database.execute(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['Alice', 'alice@example.com']
)
```

## API Overview

### Platform Context ($)

The default export `$` is a typed proxy providing access to all platform services:

```typescript
interface PlatformContext {
  Functions: FunctionsService
  Workflows: WorkflowsService
  Agents: AgentsService
  Database: DatabaseService
}
```

### Service Interfaces

#### FunctionsService

| Method | Description |
|--------|-------------|
| `create(fn: FunctionDef)` | Create a new function |
| `invoke(name: string, input: unknown)` | Invoke a function by name |
| `list()` | List all functions |

#### WorkflowsService

| Method | Description |
|--------|-------------|
| `create(workflow: WorkflowDef)` | Create a new workflow |
| `run(name: string, input: unknown)` | Run a workflow by name |
| `get(runId: string)` | Get a workflow run by ID |

#### AgentsService

| Method | Description |
|--------|-------------|
| `create(agent: AgentDef)` | Create a new agent |
| `invoke(name: string, input: string)` | Invoke an agent by name |

#### DatabaseService

| Method | Description |
|--------|-------------|
| `query<T>(sql: string, params?: unknown[])` | Execute a query and return results |
| `execute(sql: string, params?: unknown[])` | Execute a statement (INSERT, UPDATE, DELETE) |

### Type Exports

```typescript
import type {
  // Platform context
  PlatformContext,

  // Function types
  FunctionsService,
  FunctionDef,
  Function,

  // Workflow types
  WorkflowsService,
  WorkflowDef,
  WorkflowStep,
  Workflow,
  WorkflowRun,

  // Agent types
  AgentsService,
  AgentDef,
  Agent,

  // Database types
  DatabaseService,
  QueryResult,
  ExecuteResult,
} from 'platform.do'
```

## Custom Platform URL

By default, `$` connects to `https://apis.do`. You can also create a client for a custom URL:

```typescript
import { createClient } from 'platform.do'

const client = createClient({ url: 'https://custom.api.example.com' })
```

## Re-exports from sdk.do

`platform.do` re-exports everything from `sdk.do`, so you can import RPC client utilities directly:

```typescript
import {
  $,                    // Platform context
  createClient,         // RPC client factory
  TokenStore,           // Token storage
  ensureLoggedIn,       // Authentication helper
  AuthTransport,        // Authenticated transport
  FetchTransport,       // HTTP transport
} from 'platform.do'
```

## Related Packages

- [sdk.do](../sdk.do) - Base SDK (RPC client + OAuth)
- [rpc.do](../rpc.do) - RPC client implementation
- [@dotdo/oauth](../oauth) - OAuth utilities

## License

MIT
