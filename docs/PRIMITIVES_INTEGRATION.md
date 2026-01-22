# Primitives Integration Guide

This document describes the integration status between dotdo and the [primitives.org.ai](https://primitives.org.ai) packages. The primitives provide AI-native building blocks that complement dotdo's Durable Object infrastructure.

## Overview

The `primitives/` directory is a git submodule pointing to the primitives.org.ai monorepo. These packages provide production-grade AI primitives with full TypeScript support.

```
primitives/packages/
├── ai-functions        # Type-safe AI function calls
├── ai-database         # AI-powered database operations
├── ai-workflows        # Event-driven workflows
├── digital-objects     # Entity and graph system
├── digital-workers     # AI agent abstraction
├── digital-tasks       # Task queues with dependencies
├── digital-tools       # MCP-compatible tool definitions
├── business-as-code    # Business process modeling
└── ...
```

## Integration Status

| Package | Status | dotdo Integration | Notes |
|---------|--------|-------------------|-------|
| **ai-functions** | Production | `@dotdo/ai` | Template literal AI, multi-provider support |
| **digital-objects** | Production | `@dotdo/db` | Noun/Verb schema, entity validation |
| **ai-database** | TDD Phase | Planned | 10 skipped tests in db/tests/ |
| **digital-workers** | Production | Conceptual | Base for workers.do named agents |
| **digital-tasks** | Experimental | Planned | Task queue integration |
| **digital-tools** | Production | `@dotdo/mcp` | MCP tool definitions |
| **ai-workflows** | Production | `@dotdo/do` | WorkflowContext ($) patterns |
| **business-as-code** | Experimental | workers.do | Business process modeling |

## Production-Ready Integrations

### 1. ai-functions with @dotdo/ai

The `@dotdo/ai` package provides template literal AI calls powered by ai-functions:

```typescript
import { ai, list, is, write } from '@dotdo/ai'

// Inside a Durable Object
class MyDO extends DO {
  async generateContent(topic: string) {
    // Simple text generation
    const summary = await write`summarize ${topic} in 3 sentences`

    // List generation
    const ideas = await list`5 startup ideas for ${topic}`

    // Boolean decisions
    const isValid = await is`${input} is a valid email address`

    // Structured output with auto-inferred schema
    const analysis = await ai`analyze customer sentiment: ${feedback}`

    return { summary, ideas, isValid, analysis }
  }
}
```

**Features available:**
- Template literal syntax for natural AI calls
- Multi-provider support (Anthropic, OpenAI, Google)
- Automatic JSON parsing and type coercion
- Built-in retry logic and rate limiting
- Streaming support

### 2. digital-objects with @dotdo/db

The `@dotdo/db` package integrates with digital-objects for schema validation:

```typescript
import { createMemoryProvider } from 'digital-objects'
import { createDigitalObjectsAdapter } from '@dotdo/db'

// Define schema using digital-objects
const provider = createMemoryProvider()
await provider.defineNoun({
  name: 'Customer',
  schema: {
    name: { type: 'string', required: true },
    email: 'string?',
    plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
  }
})

// Create adapter for @dotdo/db
const store = createDigitalObjectsAdapter(provider)

// Use with validation
const customer = await store.create(
  { $type: 'Customer', name: 'Alice', plan: 'pro' },
  { validate: true }
)

// Linguistic forms auto-derived
const noun = await store.getNoun('Customer')
console.log(noun.plural)  // 'customers'
```

**Field mapping:**

| digital-objects | @dotdo/db |
|-----------------|-----------|
| `id` | `$id` |
| `noun` | `$type` |
| `createdAt` | `$createdAt` |
| `updatedAt` | `$updatedAt` |
| `data.*` | `*` (flattened) |

### 3. digital-tools with @dotdo/mcp

MCP tool definitions are compatible with digital-tools:

```typescript
import { defineTool } from 'digital-tools'
import { createMCPServer } from '@dotdo/mcp'

// Define tools using digital-tools format
const searchTool = defineTool({
  name: 'search',
  description: 'Search the knowledge base',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', default: 10 }
    },
    required: ['query']
  },
  execute: async ({ query, limit }) => {
    // Implementation
    return results
  }
})

// Register with MCP server
const mcp = createMCPServer()
mcp.registerTool(searchTool)
```

## TDD Phase Integrations

### ai-database Integration (Planned)

The ai-database package will provide AI-powered database operations. Integration tests are defined in `db/tests/ai-database-integration.test.ts` with 10 skipped tests:

**Planned features:**

1. **Natural Language Queries**
```typescript
// Future API
const result = await store.queryNL('show all enterprise customers from last month')
// Returns: { interpretation: '...', results: [...], sql: '...' }
```

2. **AI Value Generation**
```typescript
// Future API - resolve natural language references
const draft = await store.createDraft({
  $type: 'Lead',
  customer: 'the CEO of Acme Corp'  // Natural language
})
const lead = await store.resolveDraft(draft)
// lead.customerId = '<resolved-customer-id>'
```

3. **Semantic Search**
```typescript
// Future API - vector similarity search
const results = await store.semanticSearch('machine learning projects', {
  minScore: 0.7,
  limit: 10
})
// Returns Things sorted by semantic similarity
```

See `db/tests/ai-database-integration.test.ts` for detailed implementation requirements.

## Setup Instructions

### Initial Setup

After cloning dotdo, initialize the submodule:

```bash
npm run submodule:init
# or manually:
git submodule update --init --recursive
```

### Updating Primitives

To pull latest changes from primitives.org.ai:

```bash
npm run submodule:update
# or manually:
git submodule update --remote --merge
```

After updating, commit the new reference:

```bash
git add primitives
git commit -m "chore: update primitives submodule"
```

### Making Changes to Primitives

Changes to primitives must be committed in the primitives repo first:

```bash
cd primitives
git checkout main
git pull
# make changes
git add -A && git commit -m "your changes"
git push
cd ..
git add primitives
git commit -m "chore: update primitives submodule"
```

## Using Primitives in Your Code

### Direct Import

```typescript
// From the primitives submodule
import { ai, list, is } from './primitives/packages/ai-functions'
import { createMemoryProvider } from './primitives/packages/digital-objects'
```

### Via dotdo Re-exports (Recommended)

```typescript
// Via dotdo packages (preferred)
import { ai, list, is } from '@dotdo/ai'
import { createDigitalObjectsAdapter } from '@dotdo/db'
```

## Package Documentation

Each primitives package has comprehensive documentation:

- [ai-functions](https://primitives.org.ai/ai-functions) - AI function calls
- [digital-objects](https://primitives.org.ai/digital-objects) - Entity system
- [ai-database](https://primitives.org.ai/ai-database) - AI-powered DB
- [digital-workers](https://primitives.org.ai/digital-workers) - Worker abstraction
- [digital-tasks](https://primitives.org.ai/digital-tasks) - Task queues
- [digital-tools](https://primitives.org.ai/digital-tools) - Tool definitions

## Troubleshooting

### Submodule Not Initialized

```
Error: Cannot find module 'primitives/...'
```

Solution:
```bash
git submodule update --init --recursive
npm install
```

### Submodule Out of Date

If you see missing features or types:

```bash
npm run submodule:update
npm install
```

### Checking Submodule Status

```bash
git submodule status
# Shows current commit hash and if submodule is initialized
```

## Related Documentation

- [CLAUDE.md](/CLAUDE.md) - Repository guide including submodule info
- [ARCHITECTURE.md](/ARCHITECTURE.md) - Overall architecture
- [db/README.md](/db/README.md) - Database layer with digital-objects integration
