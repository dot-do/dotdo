# @dotdo/mcp

> Model Context Protocol server for AI agent integration

[![npm version](https://img.shields.io/npm/v/@dotdo/mcp.svg)](https://www.npmjs.com/package/@dotdo/mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Integrating AI agents with your data is a chore:

- **Custom tool building** - Every AI agent (ChatGPT, Claude, etc.) needs custom tool definitions
- **Schema duplication** - You define your data model once, then redefine it for each AI integration
- **Security concerns** - How do you safely let AI access your data without exposing everything?
- **No standard interface** - Each tool has different conventions, making maintenance a nightmare

You want AI to work with your data, not spend weeks building integrations.

## The Solution

MCP server that exposes your Digital Objects to AI agents:

```typescript
import { createMCPServer, createSearchTool, createFetchTool } from '@dotdo/mcp'
import { createThingsStore } from '@dotdo/db'

const store = createThingsStore()
const server = createMCPServer({ name: 'my-app', version: '1.0.0' })

// Add tools
server.addTool(createSearchTool(store))
server.addTool(createFetchTool({ things: store }))

// AI agents can now search and fetch your data
```

## Quick Start

### Installation

```bash
npm install @dotdo/mcp
```

### Create an MCP Server

```typescript
import { createMCPServer, createSearchTool, createFetchTool } from '@dotdo/mcp'
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

// Create stores
const adapter = new MemoryStorageAdapter()
const things = createThingsStoreWithAdapter(adapter)

// Create MCP server
const server = createMCPServer({
  name: 'my-app',
  version: '1.0.0'
})

// Add tools
server.addTool(createSearchTool(things))
server.addTool(createFetchTool({ things }))

// Start server
export default server
```

## Features

### Search Tool

Query Things with filtering, full-text search, sorting, and pagination:

```typescript
import { createSearchTool } from '@dotdo/mcp'

const searchTool = createSearchTool(store)

// Search by type
await searchTool.execute({ $type: 'Customer' })

// Search with filters
await searchTool.execute({
  $type: 'Customer',
  where: { status: 'active' },
  query: 'alice',
  orderBy: 'createdAt',
  order: 'desc',
  limit: 10
})
```

**Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `$type` | string | Filter by Thing type | - |
| `where` | object | Field value filters | - |
| `query` | string | Full-text search | - |
| `orderBy` | string | Field to sort by | - |
| `order` | 'asc' \| 'desc' | Sort order | 'desc' |
| `limit` | number | Max results (1-100) | 20 |
| `offset` | number | Skip N results | 0 |
| `select` | string[] | Fields to include | - |

### Fetch Tool

Fetch a single Thing with optional enrichments:

```typescript
import { createFetchTool } from '@dotdo/mcp'

const fetchTool = createFetchTool({
  things: store,
  relationships: relationshipsStore,
  events: eventsStore
})

// Basic fetch
await fetchTool.execute({ $id: 'customer-123' })

// With enrichments
await fetchTool.execute({
  $id: 'customer-123',
  include: ['relationships', 'events']
})
```

**Response includes:**
- All Thing properties
- `_links`: HATEOAS links
- `_relationships`: Related entities (if requested)
- `_events`: Recent events (if requested)

### Sandbox Tool

Execute code in a secure sandbox with WorkflowContext ($) support:

```typescript
import { createSandboxTool } from '@dotdo/mcp'
import { createContext } from '@dotdo/do/context'

const context = createContext(state, env)
const sandboxTool = createSandboxTool({ context })

// Execute code with $ context
await sandboxTool.execute({
  code: `
    $.send({ type: 'Order.placed', payload: { orderId: 'ord-123' } })
    return 'order event sent'
  `,
  timeout: 5000,
  permissions: {
    allowSend: true,
    allowTry: true,
    allowDo: true
  },
  audit: true
})
```

**Permissions:**

| Permission | Description |
|------------|-------------|
| `allowSend` | `$.send()` - fire-and-forget events |
| `allowTry` | `$.try()` - single attempt operations |
| `allowDo` | `$.do()` - durable operations with retries |
| `allowOn` | `$.on` - event handlers |
| `allowEvery` | `$.every` - scheduling DSL |

### Tool Discovery

Register and discover tools dynamically:

```typescript
import { ToolRegistry, ToolCategory } from '@dotdo/mcp'

const registry = new ToolRegistry()

// Register with category and capabilities
registry.register(searchTool, ToolCategory.DATA, ['search', 'query'])
registry.register(sandboxTool, ToolCategory.COMPUTE, ['sandbox', 'workflow'])

// Discover tools
registry.list()                              // All tools
registry.listByCategory(ToolCategory.DATA)   // Data tools only
registry.listByCapability('sandbox')         // Tools with sandbox capability

// Tool metadata (for MCP protocol)
registry.listMetadata()
```

## API Reference

### Server

```typescript
createMCPServer(options: { name: string; version: string }): MCPServer

interface MCPServer {
  addTool(tool: Tool): void
  fetch(request: Request): Promise<Response>
}
```

### Tools

```typescript
createSearchTool(store: ThingsStore): Tool
createFetchTool(stores: { things: ThingsStore; relationships?: RelationshipsStore; events?: EventsStore }): Tool
createSandboxTool(options: { context: WorkflowContext }): Tool
```

### Tool Registry

```typescript
interface ToolRegistry {
  register(tool: Tool, category: ToolCategory, capabilities: string[]): void
  unregister(name: string): void
  get(name: string): Tool | undefined
  list(): Tool[]
  listByCategory(category: ToolCategory): Tool[]
  listByCapability(capability: string): Tool[]
  listMetadata(): ToolMetadata[]
  on(event: 'tool:registered' | 'tool:unregistered', handler: (name: string) => void): void
}

enum ToolCategory {
  DATA = 'data',
  COMPUTE = 'compute',
  INTEGRATION = 'integration'
}
```

## MCP Protocol Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/initialize` | POST | Initialize connection |
| `/mcp/tools` | GET | List available tools |
| `/mcp/tools/call` | POST | Execute a tool |
| `/` | GET | Health check |

### Request Format

```json
POST /mcp/tools/call
{
  "name": "search",
  "arguments": {
    "$type": "Customer",
    "where": { "status": "active" },
    "limit": 10
  }
}
```

### Response Format

```json
{
  "results": [...],
  "total": 42,
  "hasMore": true,
  "limit": 10,
  "offset": 0
}
```

## Examples

### Complete MCP Server

```typescript
import { createMCPServer, createSearchTool, createFetchTool, createSandboxTool, ToolRegistry, ToolCategory } from '@dotdo/mcp'
import { createThingsStoreWithAdapter, createRelationshipsStoreWithAdapter, createEventsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

// Create shared adapter
const adapter = new MemoryStorageAdapter()
const things = createThingsStoreWithAdapter(adapter)
const relationships = createRelationshipsStoreWithAdapter(adapter)
const events = createEventsStoreWithAdapter(adapter)

// Create server
const server = createMCPServer({ name: 'my-mcp', version: '1.0.0' })

// Create tools
const searchTool = createSearchTool(things)
const fetchTool = createFetchTool({ things, relationships, events })

// Register tools
const registry = new ToolRegistry()
registry.register(searchTool, ToolCategory.DATA, ['search', 'query', 'list'])
registry.register(fetchTool, ToolCategory.DATA, ['fetch', 'get', 'read'])

// Add to server
server.addTool(searchTool)
server.addTool(fetchTool)

export default server
```

### Integration with Durable Objects

```typescript
import { DO } from '@dotdo/do'
import { createMCPServer, createSearchTool, createFetchTool } from '@dotdo/mcp'

export class MyDO extends DO {
  private mcp: MCPServer

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Create MCP server with DO's stores
    this.mcp = createMCPServer({ name: 'my-do', version: '1.0.0' })
    this.mcp.addTool(createSearchTool(this.things))
    this.mcp.addTool(createFetchTool({
      things: this.things,
      relationships: this.relationships,
      events: this.events
    }))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Route MCP requests
    if (url.pathname.startsWith('/mcp')) {
      return this.mcp.fetch(request)
    }

    // Handle other requests...
    return super.fetch(request)
  }
}
```

## Related Packages

| Package | Description |
|---------|-------------|
| [@dotdo/do](/do) | Durable Object with built-in storage |
| [@dotdo/db](/db) | Abstract storage layer |
| [@dotdo/api](/api) | Self-describing Hono API |
| [@dotdo/ai](/ai) | AI template literals |

## Resources

- [MCP Specification](https://modelcontextprotocol.org)
- [dotdo Documentation](https://dotdo.dev)

## License

MIT
