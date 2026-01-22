# Todo App Example

A simple CRUD todo list demonstrating dotdo capabilities with Cloudflare Durable Objects.

## Features

- **Durable Object Storage**: Per-user todo lists using SQLite in DOs
- **RESTful API**: Standard CRUD operations via Hono
- **Type-Safe**: Full TypeScript support
- **Self-Describing**: API discovery at root endpoint

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# The API will be available at http://localhost:8787
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API discovery |
| `GET` | `/todos` | List all todos |
| `POST` | `/todos` | Create a todo |
| `GET` | `/todos/:id` | Get a todo by ID |
| `PATCH` | `/todos/:id` | Update a todo |
| `DELETE` | `/todos/:id` | Delete a todo |
| `POST` | `/todos/:id/toggle` | Toggle completion |

## Usage Examples

### Create a Todo

```bash
curl -X POST http://localhost:8787/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn dotdo"}'
```

Response:
```json
{
  "id": "m5abc123-xyz789",
  "title": "Learn dotdo",
  "completed": false,
  "createdAt": 1705123456789,
  "updatedAt": 1705123456789
}
```

### List Todos

```bash
curl http://localhost:8787/todos
```

Response:
```json
{
  "data": [
    {
      "id": "m5abc123-xyz789",
      "title": "Learn dotdo",
      "completed": false,
      "createdAt": 1705123456789,
      "updatedAt": 1705123456789
    }
  ],
  "total": 1
}
```

### Toggle Completion

```bash
curl -X POST http://localhost:8787/todos/m5abc123-xyz789/toggle
```

### Update a Todo

```bash
curl -X PATCH http://localhost:8787/todos/m5abc123-xyz789 \
  -H "Content-Type: application/json" \
  -d '{"title": "Master dotdo", "completed": true}'
```

### Delete a Todo

```bash
curl -X DELETE http://localhost:8787/todos/m5abc123-xyz789
```

## Multi-User Support

Each user gets their own isolated todo list. Pass the `X-User-ID` header to specify the user:

```bash
curl http://localhost:8787/todos -H "X-User-ID: alice"
curl http://localhost:8787/todos -H "X-User-ID: bob"
```

## Architecture

```
Worker (Stateless)
    |
    +-> TodoDO (Durable Object per user)
            |
            +-> SQLite Storage
```

- **Worker**: Routes requests to appropriate DO based on user ID
- **TodoDO**: Handles all CRUD operations with SQLite storage
- **SQLite**: Persistent storage within the DO

## Key Patterns Demonstrated

1. **Namespace Routing**: User ID determines which DO instance handles the request
2. **DO-Internal Hono**: Full Hono app inside the Durable Object
3. **SQLite Schema**: Auto-initializing schema with migrations
4. **Typed Entities**: Strong TypeScript types for all data

## Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## Project Structure

```
todo-app/
├── src/
│   ├── index.ts      # Worker entry point
│   └── TodoDO.ts     # Durable Object implementation
├── package.json
├── tsconfig.json
├── wrangler.jsonc    # Cloudflare config
└── README.md
```

## Related Examples

- [auth-api](../auth-api) - API with JWT authentication
- [realtime-chat](../realtime-chat) - Real-time WebSocket chat
