# Basic REST API

The simplest possible dotdo application - just an `App.tsx` file.

## Quick Start

```bash
# Navigate to this directory
cd examples/do-start/01-basic-rest-api

# Start the dev server (zero config!)
do start
```

That's it. No configuration files needed.

## What This Demonstrates

1. **Zero-config pattern** - No `wrangler.jsonc`, no `do.config.ts` required
2. **Auto-discovery** - The CLI discovers `App.tsx` and runs it
3. **Basic DO with REST** - A simple task tracker with CRUD operations
4. **Automatic SQLite** - Persistent storage without setup

## Project Structure

```
01-basic-rest-api/
  App.tsx         # Your entire application
  README.md       # This file
```

## How It Works

When you run `do start`:

1. The CLI looks for `App.tsx` in the current directory
2. If found, it scaffolds any missing infrastructure (`.do/` directory)
3. Starts a local dev server with Miniflare
4. Your DO classes become REST endpoints automatically

## API Endpoints

The `Tasks` DO class automatically gets these endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/Tasks/` | List all task namespaces |
| GET | `/Tasks/:id` | Get a specific task tracker |
| POST | `/Tasks/:id/createTask` | Create a new task |
| POST | `/Tasks/:id/completeTask` | Mark task complete |
| DELETE | `/Tasks/:id/Task/:taskId` | Delete a task |

## Example Usage

```bash
# Create a task
curl -X POST http://localhost:4000/Tasks/my-list/createTask \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy groceries", "description": "Milk, eggs, bread"}'

# List tasks
curl http://localhost:4000/Tasks/my-list

# Complete a task
curl -X POST http://localhost:4000/Tasks/my-list/completeTask \
  -H "Content-Type: application/json" \
  -d '{"id": "task-id-here"}'
```

## Next Steps

- Add a `do.config.ts` for custom configuration
- Add more DO classes for different domains
- See `02-with-filesystem` for file storage
- See `03-with-agents` for AI integration
