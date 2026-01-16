# example.org.ai

Interactive examples demonstrating dotdo Durable Object patterns and capabilities.

## Browse Examples

### Applications

| Example | Description |
|---------|-------------|
| [crm.example.org.ai](https://crm.example.org.ai) | Multi-tenant CRM with semantic primitives |
| [invoices.example.org.ai](https://invoices.example.org.ai) | Invoice generation and tracking |
| [kanban.example.org.ai](https://kanban.example.org.ai) | Kanban board with drag-drop |
| [marketplace.example.org.ai](https://marketplace.example.org.ai) | Multi-vendor marketplace |
| [notes.example.org.ai](https://notes.example.org.ai) | Note-taking with collaboration |
| [saas.example.org.ai](https://saas.example.org.ai) | Multi-tenant SaaS boilerplate |
| [shop.example.org.ai](https://shop.example.org.ai) | E-commerce with inventory |
| [support.example.org.ai](https://support.example.org.ai) | Support ticket system |

### Real-time

| Example | Description |
|---------|-------------|
| [chat.example.org.ai](https://chat.example.org.ai) | Chat rooms with WebSocket streaming |
| [game.example.org.ai](https://game.example.org.ai) | Multiplayer game state |
| [stream.example.org.ai](https://stream.example.org.ai) | Event streaming with cursors |

### Content

| Example | Description |
|---------|-------------|
| [blog.example.org.ai](https://blog.example.org.ai) | Content management with versioning |
| [docs.example.org.ai](https://docs.example.org.ai) | Documentation with search |
| [wiki.example.org.ai](https://wiki.example.org.ai) | Wiki with revision history |

### Compatibility Layers

| Example | Description |
|---------|-------------|
| [redis.example.org.ai](https://redis.example.org.ai) | Redis-compatible cache and pub/sub |
| [mongo.example.org.ai](https://mongo.example.org.ai) | MongoDB-compatible document store |
| [postgres.example.org.ai](https://postgres.example.org.ai) | PostgreSQL-compatible queries |
| [kafka.example.org.ai](https://kafka.example.org.ai) | Kafka-compatible message streaming |

### Infrastructure

| Example | Description |
|---------|-------------|
| [queue.example.org.ai](https://queue.example.org.ai) | Job queue with priorities |
| [ratelimit.example.org.ai](https://ratelimit.example.org.ai) | Rate limiting primitives |
| [cron.example.org.ai](https://cron.example.org.ai) | Cron-like scheduled tasks |
| [pipeline.example.org.ai](https://pipeline.example.org.ai) | Event pipeline with L0-L3 storage |
| [workflow.example.org.ai](https://workflow.example.org.ai) | Event-driven workflow automation |

### Storage

| Example | Description |
|---------|-------------|
| [sqlite.example.org.ai](https://sqlite.example.org.ai) | Raw SQLite access patterns |
| [iceberg.example.org.ai](https://iceberg.example.org.ai) | Cold storage with Apache Iceberg |

### AI

| Example | Description |
|---------|-------------|
| [ai.example.org.ai](https://ai.example.org.ai) | LLM template literals and routing |
| [agents.example.org.ai](https://agents.example.org.ai) | Agent SDK demonstration |

### Data

| Example | Description |
|---------|-------------|
| [analytics.example.org.ai](https://analytics.example.org.ai) | Real-time analytics aggregation |
| [forms.example.org.ai](https://forms.example.org.ai) | Form builder and submissions |

## Architecture

Each example is a namespace within the same Durable Object deployment:

```
crm.example.org.ai  -> DOFull('crm')
redis.example.org.ai -> DOFull('redis')
```

No separate deployments. Same worker, isolated state per namespace.

## Quick Start

```bash
# Create a CRM contact
curl -X POST https://crm.example.org.ai/contacts \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Set a Redis key
curl -X POST https://redis.example.org.ai/set \
  -H "Content-Type: application/json" \
  -d '{"key": "hello", "value": "world"}'

# Send a chat message
curl -X POST https://chat.example.org.ai/rooms/general/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello!", "author": "user123"}'
```

## Learn More

- [dotdo Documentation](https://dotdo.dev)
- [GitHub Repository](https://github.com/dot-do/dotdo)
- [workers.do Platform](https://workers.do)
