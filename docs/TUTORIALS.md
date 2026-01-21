# Video Tutorials and Interactive Playground

This document outlines the planned video tutorial series and interactive playground for dotdo. The goal is to provide visual learning resources for developers new to Durable Objects.

## Table of Contents

1. [Video Tutorial Series](#video-tutorial-series)
2. [Interactive Playground](#interactive-playground)
3. [Architecture Diagrams](#architecture-diagrams)
4. [Screencasts for Common Tasks](#screencasts-for-common-tasks)
5. [Existing Resources](#existing-resources)

---

## Video Tutorial Series

### Series 1: Getting Started (Beginner)

A YouTube playlist introducing dotdo fundamentals for developers new to Durable Objects.

| Episode | Title | Duration | Topics |
|---------|-------|----------|--------|
| 1.1 | **What is dotdo?** | ~10 min | Overview of Durable Objects, dotdo vs workers.do, when to use |
| 1.2 | **Your First Durable Object** | ~15 min | Setup, Counter example, local development with wrangler |
| 1.3 | **SQLite Storage Basics** | ~12 min | Built-in SQLite, entity stores (Things), persistence |
| 1.4 | **HTTP Routes with Hono** | ~12 min | Adding routes, CORS, error handling |
| 1.5 | **RPC Communication** | ~10 min | Worker-to-DO, DO-to-DO, when to use RPC vs HTTP |
| 1.6 | **Testing with Miniflare** | ~15 min | Vitest setup, NO MOCKS philosophy, real SQLite tests |
| 1.7 | **Deploying to Cloudflare** | ~8 min | wrangler deploy, migrations, production testing |

### Series 2: Core Concepts (Intermediate)

Deep dives into dotdo's architecture and patterns.

| Episode | Title | Duration | Topics |
|---------|-------|----------|--------|
| 2.1 | **Entity Management** | ~15 min | Things, Relationships, Events stores |
| 2.2 | **WorkflowContext ($)** | ~18 min | Event handlers, durability levels, scheduling |
| 2.3 | **WebSocket Support** | ~15 min | Real-time connections, hibernation, broadcasting |
| 2.4 | **Cross-DO Communication** | ~12 min | $.Customer(id).notify(), caching, retries |
| 2.5 | **HATEOAS and Self-Describing APIs** | ~10 min | Auto-generated SDK, CLI, MCP |
| 2.6 | **Authentication with @dotdo/auth** | ~12 min | JWT, jose, middleware patterns |

### Series 3: Real-World Applications (Advanced)

Building complete applications with dotdo.

| Episode | Title | Duration | Topics |
|---------|-------|----------|--------|
| 3.1 | **E-commerce Checkout System** | ~25 min | Cart, payment, order tracking |
| 3.2 | **Real-time Collaboration** | ~25 min | Presence, cursors, operational transforms |
| 3.3 | **AI Agent with Memory** | ~20 min | Conversation state, tool execution |
| 3.4 | **Multi-tenant SaaS** | ~20 min | Namespace isolation, tenant DOs |
| 3.5 | **Event-Driven Workflows** | ~18 min | $.on.Noun.verb, state machines |

### Series 4: Compat Layer (Integration)

Using dotdo with familiar APIs.

| Episode | Title | Duration | Topics |
|---------|-------|----------|--------|
| 4.1 | **Redis-Compatible Caching** | ~12 min | compat-redis example |
| 4.2 | **PostgreSQL-Style Queries** | ~15 min | compat-postgres multi-tenant |
| 4.3 | **Pusher-Compatible Realtime** | ~12 min | compat-pusher-realtime |
| 4.4 | **Clerk-Compatible Auth** | ~15 min | compat-clerk users, sessions, orgs |

---

## Interactive Playground

### Concept

A browser-based playground similar to StackBlitz or CodeSandbox that allows developers to experiment with dotdo without local setup.

### Planned Features

#### Core Functionality

- **In-browser editor** with TypeScript support and IntelliSense
- **Live preview** showing API responses and WebSocket connections
- **Miniflare runtime** via WebAssembly for real DO execution
- **SQLite inspector** to view and query DO state
- **Request builder** for testing HTTP endpoints and RPC calls

#### Pre-built Templates

| Template | Description |
|----------|-------------|
| **Counter** | Basic DO with increment/decrement |
| **Task Manager** | CRUD with Things store |
| **Chat Room** | WebSocket real-time messaging |
| **Shopping Cart** | E-commerce cart with checkout |
| **AI Agent** | Stateful conversation with tools |

#### Learning Features

- **Guided walkthroughs** with step-by-step instructions
- **Code challenges** with automated validation
- **Side-by-side documentation** context-aware to current code
- **Fork and share** for collaboration and saving progress

### Technical Implementation

```
Architecture:
  Browser → Monaco Editor → TypeScript Worker → Miniflare WASM → DO Runtime
                ↓
         Preview Panel ← HTTP/WebSocket ← Simulated Worker
```

Key technologies:
- Monaco Editor for code editing
- esbuild-wasm for TypeScript compilation
- Miniflare (Cloudflare's local simulator) compiled to WASM
- WebContainers as fallback for full Node.js compatibility

### Example Playground Session

```typescript
// playground.ts - editable in browser
import { DO } from 'dotdo'

export class Counter extends DO {
  private count = 0

  async increment(): Promise<number> {
    return ++this.count
  }

  async getValue(): Promise<number> {
    return this.count
  }
}

// Click "Run" to test:
// > await counter.increment()
// { result: 1 }
// > await counter.getValue()
// { result: 1 }
```

---

## Architecture Diagrams

### Planned Diagram Set

Visual documentation using Mermaid or Excalidraw:

| Diagram | Description |
|---------|-------------|
| **dotdo Overview** | High-level architecture showing packages and data flow |
| **DO Lifecycle** | Creation, hibernation, eviction, cold start recovery |
| **Request Flow** | Client -> Worker -> DO routing |
| **$ Context DSL** | Event handlers, scheduling, RPC visualization |
| **Entity Model** | Things, Relationships, Events schema |
| **WebSocket Flow** | Connection upgrade, hibernation, broadcasting |
| **Multi-tenant Isolation** | Namespace derivation from hostname |

### Example: Request Flow Diagram

```
┌──────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Client     │────►│  Worker (Hono)  │────►│  Durable Object │
│  (Browser)   │     │  (Passthrough)  │     │    (DO.ts)      │
└──────────────┘     └─────────────────┘     └─────────────────┘
       │                     │                       │
       │  HTTP/WS Request    │   idFromName(ns)     │
       │                     │   stub.fetch()       │
       ▼                     ▼                       ▼
    tenant.api.dotdo.dev  →  ns = "tenant"  →  DO('tenant')
```

---

## Screencasts for Common Tasks

Short (2-5 minute) screencasts demonstrating specific tasks.

### Development Workflow

| Screencast | Duration | Description |
|------------|----------|-------------|
| **Local Setup** | 3 min | npm install, wrangler dev, first request |
| **Adding a Route** | 2 min | Create Hono route in DO, test with curl |
| **Creating an Entity** | 3 min | Use Things store, verify in SQLite |
| **Writing a Test** | 4 min | Vitest setup, test via RPC, verify persistence |
| **Debugging with Logs** | 3 min | wrangler tail, console.log, error handling |

### Deployment

| Screencast | Duration | Description |
|------------|----------|-------------|
| **First Deploy** | 3 min | wrangler deploy, verify production URL |
| **Adding Migrations** | 3 min | Schema changes, migration tags |
| **Custom Domain** | 4 min | Routes configuration, DNS setup |
| **Environment Variables** | 2 min | Secrets, [vars] section |

### Advanced Patterns

| Screencast | Duration | Description |
|------------|----------|-------------|
| **Event Handlers** | 4 min | $.on.Customer.signup, emit events |
| **Scheduled Tasks** | 3 min | $.every.day.at('9am'), cron patterns |
| **Cross-DO RPC** | 5 min | $.Order(id).ship(), caching |
| **WebSocket Setup** | 5 min | Upgrade, broadcast, hibernation |

---

## Existing Resources

### Text Documentation

- [Getting Started Guide](/docs/GETTING_STARTED.md) - Step-by-step tutorial
- [Getting Started (Detailed)](/docs/getting-started.md) - Comprehensive walkthrough
- [Troubleshooting](/docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Migration Guide](/docs/MIGRATION_V1_V2_TO_V3.md) - Upgrading from v1/v2
- [Deployment Guide](/docs/DEPLOYMENT.md) - Production deployment

### Blog Posts and Case Studies

- [Introducing dotdo](/docs/blog/introducing-dotdo.md) - Core concepts overview
- [E-commerce Case Study](/docs/blog/case-study-ecommerce.md) - Shopping cart and checkout
- [Real-time Collaboration](/docs/blog/case-study-realtime.md) - Collaborative editing
- [AI Agent Case Study](/docs/blog/case-study-ai-agent.md) - Stateful AI conversations

### Code Examples (in .worktrees/v1/examples/)

| Example | Description |
|---------|-------------|
| `agent-code-review/` | AI code review loop with Ralph + Tom agents |
| `agent-incident-response/` | Automated incident response workflow |
| `agent-launch-campaign/` | Marketing campaign orchestration |
| `agent-startup-launch/` | Full startup launch automation |
| `autonomous-startup/` | Autonomous business operations |
| `compat-redis/` | Redis-compatible caching |
| `compat-postgres-multi-tenant/` | PostgreSQL-style multi-tenant |
| `compat-pusher-realtime/` | Pusher-compatible real-time |
| `compat-clerk/` | Clerk-compatible authentication |
| `compat-algolia-search/` | Algolia-compatible search |
| `compat-supabase-auth/` | Supabase-compatible auth |

### Architecture Decision Records

- [ADR-001: Monorepo Structure](/docs/adr/ADR-001-monorepo-structure.md)
- [ADR-002: Durable Objects as Core Primitive](/docs/adr/ADR-002-durable-objects-as-core-primitive.md)
- [ADR-003: RPC-First Communication](/docs/adr/ADR-003-rpc-first-communication.md)

---

## Contributing

We welcome contributions to the tutorial content:

1. **Video scripts**: Submit outlines or full scripts for planned episodes
2. **Playground templates**: Create new interactive examples
3. **Diagrams**: Design architecture visualizations
4. **Screencasts**: Record short task demonstrations

See the main [CONTRIBUTING.md](/CONTRIBUTING.md) for contribution guidelines.

---

## Target Audience

All tutorials and playground content target:

- **Primary**: Developers new to Durable Objects who want visual learning
- **Secondary**: Experienced Cloudflare Workers developers exploring dotdo
- **Tertiary**: Infrastructure developers evaluating dotdo for production use

Prerequisites assumed:
- Basic TypeScript/JavaScript knowledge
- Familiarity with REST APIs
- Some experience with serverless or edge computing (helpful but not required)
