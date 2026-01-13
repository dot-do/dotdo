# lib/ - Core Library Modules

This directory contains reusable library modules for the dotdo platform. These modules provide foundational capabilities that are used across Durable Objects, workflows, and the API layer.

## Directory Structure

```
lib/
├── ai/              # AI gateway and tool loop agent
├── browse/          # Browser automation abstraction
├── cache/           # Cache visibility and utilities
├── channels/        # Multi-channel notification adapters
├── cloudflare/      # Cloudflare binding wrappers (KV, R2, Queues, AI, etc.)
├── executors/       # Function executors (Code, Generative, Agentic, Human)
├── flags/           # Feature flag store
├── functions/       # Function registry and composition
├── humans/          # Human escalation primitives (humans.do)
├── logging/         # Structured logging infrastructure
├── mixins/          # Durable Object capability mixins
├── rate-limit/      # Rate limiting utilities
├── rpc/             # RPC binding architecture
├── sandbox/         # Miniflare sandbox utilities
├── sql/             # SQL parser abstraction
├── utils/           # General utilities
├── vault/           # Secure credential storage
└── tests/           # Library-level tests
```

## Core Modules

### ai/
AI gateway client and tool loop agent for multi-provider AI inference.

- **gateway.ts** - Unified AI client routing to Workers AI or external providers (OpenAI, Anthropic, Google) via Cloudflare AI Gateway
- **tool-loop-agent.ts** - Agent that executes tool calls in a loop until completion

```typescript
import { AIGatewayClient } from 'lib/ai/gateway'

const client = new AIGatewayClient(
  { provider: 'openai', model: 'gpt-4' },
  env
)
const response = await client.chat([{ role: 'user', content: 'Hello' }])
```

### browse/
Browser automation abstraction layer supporting Cloudflare Browser Rendering and Browserbase.

- **index.ts** - `Browse` factory for creating browser sessions
- **cloudflare.ts** - Cloudflare Browser Rendering provider
- **browserbase.ts** - Browserbase provider with live view support

```typescript
import { Browse } from 'lib/browse'

const session = await Browse.init({ provider: 'cloudflare', env })
await session.goto('https://example.com.ai')
await session.act('Click the login button')
const data = await session.extract('Get the user profile')
```

### channels/
Multi-channel notification adapters for human-in-the-loop workflows.

- **slack-blockkit.ts** - Slack BlockKit interactive messages
- **discord.ts** - Discord webhooks and embeds
- **email.ts** - Email via SendGrid/Resend
- **mdxui-chat.ts** - MDXUI Chat integration

```typescript
import { createChannel } from 'lib/channels'

const slack = createChannel('slack', { webhookUrl: '...' })
await slack.send({ title: 'Approval Required', actions: ['Approve', 'Reject'] })
```

### cloudflare/
Typed wrappers for Cloudflare bindings with enhanced functionality.

- **kv.ts** - KV Store with namespacing, TTL helpers, rate limiting, caching
- **r2.ts** - R2 object storage with path utilities and tenant isolation
- **queues.ts** - Queue message types, retry policies, batch processing
- **ai.ts** - Workers AI with model configuration and fallbacks
- **vectorize.ts** - Vector search and semantic search client
- **workflows.ts** - Durable workflow definitions with saga patterns

```typescript
import { createKVStore, createR2Store } from 'lib/cloudflare'

const store = createKVStore(env.KV, { namespace: 'tenant-123' })
await store.set('key', { data: 'value' }, { ttl: store.ttl.hours(1) })

const r2 = createR2Store(env.BUCKET, { prefix: 'uploads' })
await r2.put('file.txt', content)
```

### executors/
Function executors for different execution strategies.

- **CodeFunctionExecutor.ts** - Execute TypeScript/JavaScript code
- **GenerativeFunctionExecutor.ts** - LLM-based generation
- **AgenticFunctionExecutor.ts** - Multi-step agent with tools
- **HumanFunctionExecutor.ts** - Human-in-the-loop workflows
- **CascadeExecutor.ts** - Try multiple executors in sequence
- **ParallelStepExecutor.ts** - Execute steps in parallel

### functions/
Function registry and composition utilities.

- **FunctionRegistry.ts** - Register, discover, and manage function definitions
- **FunctionComposition.ts** - Compose functions together
- **createFunction.ts** - Factory for creating typed functions

```typescript
import { FunctionRegistry } from 'lib/functions/FunctionRegistry'

const registry = new FunctionRegistry()
registry.registerCode({
  name: 'processOrder',
  handler: async (input) => { /* ... */ }
})
```

### humans/
Human escalation primitives exported as `humans.do`.

- **templates.ts** - Role templates with template literal syntax (ceo, legal, cfo, etc.)
- **index.ts** - Package exports including HumanFunction config

```typescript
import { ceo, legal } from 'lib/humans'

const approved = await ceo`approve the partnership deal`
const reviewed = await legal`review contract ${contractId}`
```

### logging/
Structured logging abstraction replacing console.log.

- **index.ts** - Logger with levels, JSON output, correlation IDs, child loggers
- **error-logger.ts** - Error-specific logging utilities

```typescript
import { createLogger, LogLevel } from 'lib/logging'

const logger = createLogger({ name: 'my-service', level: LogLevel.INFO })
logger.info('Request received', { requestId: 'req-123' })
// Output: {"timestamp":"...","level":"info","message":"Request received","requestId":"req-123"}
```

### mixins/
Durable Object capability mixins for extending DO functionality.

- **fs.ts** - `withFs` - Filesystem capability ($.fs)
- **git.ts** - `withGit` - Git operations ($.git) - requires withFs
- **bash.ts** - `withBash` - Shell execution ($.bash) - requires withFs
- **npm.ts** - `withNpm` - Package management ($.npm) - requires withFs

```typescript
import { withGit, withFs } from 'lib/mixins'

class MyDO extends withGit(withFs(DO)) {
  async deploy() {
    await this.$.fs.write('/config.json', JSON.stringify(config))
    await this.$.git.add('.')
    await this.$.git.commit('chore: update config')
    await this.$.git.push()
  }
}
```

### rpc/
RPC binding architecture for capability modules running as separate Workers.

- **bindings.ts** - Type-safe RPC bindings for AI, KV, R2, D1, Queues, Vectorize

```typescript
import { createAIBinding, createCapabilityProxy } from 'lib/rpc'

const ai = createAIBinding(env.AI_SERVICE)
const result = await ai.call('ai.generate', { prompt: 'Hello' })
```

### sql/
Unified SQL parser abstraction supporting multiple backends.

- **types.ts** - AST types, parser interface, validation types
- **adapters/** - Parser implementations (node-sql-parser, pgsql-parser)

```typescript
import { createSQLParser } from 'lib/sql'

const parser = createSQLParser({ adapter: 'node-sql-parser' })
const result = parser.parse('SELECT * FROM users WHERE active = true')
const validation = parser.validate('SELEC * FROM users')
```

### vault/
Secure credential storage with OAuth support.

- **store.ts** - WorkOS Vault-style credential storage with user isolation, TTL, and OAuth token management

```typescript
import { createMockVaultContext } from 'lib/vault/store'

const $ = createMockVaultContext()
await $.vault('user:123').set('api-key', 'sk-secret', { ttl: 3600 })
const cred = await $.vault('user:123').get('api-key')
```

## Standalone Modules

### auto-wiring.ts
DO auto-wiring via reflection. Discovers public methods on DO subclasses and exposes them to SDK/RPC/MCP/REST/CLI transports.

### capabilities.ts
Capability lazy loading system. Provides lazy loading of capability modules ($.fs, $.git, $.bash) that are loaded on first access.

### decorators.ts
TypeScript decorators for DO methods and properties.

### discovery.ts
Service discovery utilities for finding and connecting to DOs.

### DOAuth.ts
Authentication capability for Durable Objects with Hono-based auth routes, OAuth federation, and session management.

```typescript
class MyDO extends DO {
  private auth = new DOAuth(this, { federate: true })

  async fetch(request: Request) {
    const authResponse = await this.auth.handle(request)
    if (authResponse) return authResponse
    return super.fetch(request)
  }
}
```

### DODispatcher.ts
Request dispatcher for routing to DO methods.

### experiments.ts
A/B testing and experiment management utilities.

### identity.ts
Identity and authentication utilities.

### Modifier.ts
Modifier chain for transforming workflow inputs/outputs.

### noun-id.ts
Noun/id format parser for Thing references (e.g., `Customer/acme`, `Startup/acme@v1234`).

```typescript
import { parseNounId } from 'lib/noun-id'

const ref = parseNounId('Startup/acme@experiment')
// { noun: 'Startup', id: 'acme', branch: 'experiment' }
```

### rate-limit.ts
Rate limiting utilities with sliding window algorithm.

### safe-stringify.ts
JSON stringify that handles circular references safely.

### sqids.ts
Short unique ID generation using Sqids algorithm.

### StateStorage.ts
Type-safe wrapper around Durable Object state API with batch operations, transactions, schema validation, versioning, TTL, and key prefixing.

### type-classifier.ts
Type classification utilities for runtime type checking.

### TypeRegistry.ts
Registry for managing type definitions.

### validation.ts
Input validation utilities.
