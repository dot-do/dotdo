# @dotdo/mcp

Model Context Protocol (MCP) server implementation for dotdo with core tools.

## Overview

This package provides an MCP server that enables AI assistants (like ChatGPT, Claude) to interact with dotdo's Digital Object storage layer.

## Tools

1. **search** - Query Things in the Digital Object store
2. **fetch** - Fetch a single Thing by $id with enrichments (relationships, events)
3. **do** - Execute code in a basic sandbox
4. **sandbox** - Execute code in a secure sandbox with full $ context (send, try, do, on, every)

## Usage

### Search Tool

Search for Things in the Digital Object store with powerful filtering, full-text search, sorting, and pagination.

```typescript
import { createMCPServer, createSearchTool } from '@dotdo/mcp'
import { createThingsStore } from '@dotdo/db'

const store = createThingsStore()
const server = createMCPServer({ name: 'my-app', version: '1.0.0' })

// Add search tool
server.addTool(createSearchTool(store))

// Use via MCP protocol
const request = new Request('http://localhost/mcp/tools/call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'search',
    arguments: {
      $type: 'User',
      where: { role: 'admin' },
      query: 'alice',
      orderBy: 'age',
      order: 'desc',
      limit: 10,
      offset: 0,
      select: ['name', 'email']
    }
  })
})

const response = await server.fetch(request)
```

#### Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `$type` | string | Filter by Thing type | - |
| `where` | object | Field value filters | - |
| `query` | string | Full-text search (case-insensitive) | - |
| `orderBy` | string | Field to sort by | - |
| `order` | 'asc' \| 'desc' | Sort order | 'desc' |
| `limit` | number | Max results (1-100) | 20 |
| `offset` | number | Skip N results | 0 |
| `select` | string[] | Fields to include ($id, $type always included) | - |

#### Response

```typescript
interface SearchResult {
  results: Thing[]      // Array of matching Things
  total: number         // Total count (before pagination)
  hasMore: boolean      // True if more results available
  limit: number         // Applied limit
  offset: number        // Applied offset
}
```

#### Examples

```typescript
// Search all Users
await searchTool.execute({ $type: 'User' })

// Search by field value
await searchTool.execute({ $type: 'User', where: { role: 'admin' } })

// Full-text search
await searchTool.execute({ $type: 'User', query: 'alice' })

// Paginated with sorting
await searchTool.execute({
  $type: 'User',
  orderBy: 'age',
  order: 'asc',
  limit: 10,
  offset: 0
})

// Field selection
await searchTool.execute({
  $type: 'User',
  select: ['name', 'email']
})

// Combined filters
await searchTool.execute({
  $type: 'User',
  where: { role: 'user' },
  query: 'example.com',
  orderBy: 'age',
  limit: 10
})
```

### Fetch Tool

Fetch a single Thing by its $id with optional enrichments.

```typescript
import { createMCPServer, createFetchTool } from '@dotdo/mcp'
import { createThingsStore } from '@dotdo/mcp/db/things'
import { createRelationshipsStore } from '@dotdo/mcp/db/relationships'
import { createEventsStore } from '@dotdo/mcp/db/events'

// Create stores
const things = createThingsStore()
const relationships = createRelationshipsStore()
const events = createEventsStore()

// Create MCP server
const server = createMCPServer({ name: 'my-mcp', version: '1.0.0' })

// Add fetch tool
const fetchTool = createFetchTool({ things, relationships, events })
server.addTool(fetchTool)

// Use the tool
const result = await fetchTool.execute({
  $id: 'customer-123',
  include: ['relationships', 'events']
})
```

#### Parameters

- `$id` (required): The unique identifier of the Thing to fetch
- `include` (optional): Array of enrichments to include:
  - `'relationships'`: Include both inbound and outbound relationships
  - `'events'`: Include recent events (max 100)

#### Response

Returns an enriched Thing with:
- All original Thing properties (`$id`, `$type`, `$createdAt`, `$updatedAt`, custom fields)
- `_links`: HATEOAS links (self)
- `_relationships`: Array of relationships (if requested)
- `_events`: Array of recent events (if requested)

#### Examples

```typescript
// Fetch basic Thing
const customer = await fetchTool.execute({ $id: 'cust-123' })
// Returns: { $id: 'cust-123', $type: 'Customer', name: 'Alice', ... }

// Fetch with relationships
const customerWithRels = await fetchTool.execute({
  $id: 'cust-123',
  include: ['relationships']
})
// Returns: { ..., _relationships: [{ subject, predicate, object, $createdAt }] }

// Fetch with all enrichments
const enriched = await fetchTool.execute({
  $id: 'cust-123',
  include: ['relationships', 'events']
})
// Returns: { ..., _relationships: [...], _events: [...] }
```

## Testing

All tools include comprehensive test coverage:

```bash
# Run all MCP tests
npx vitest run mcp/tests/

# Run specific test
npx vitest run mcp/tests/search.test.ts

# Run example
npx tsx mcp/examples/search-example.ts
```

## MCP Protocol Endpoints

- `POST /mcp/initialize` - Initialize connection
- `GET /mcp/tools` - List available tools
- `POST /mcp/tools/call` - Execute a tool
- `GET /` - Health check

### Sandbox Tool

Execute code in a secure sandbox with full $ WorkflowContext support.

```typescript
import { createMCPServer, createSandboxTool } from '@dotdo/mcp'
import { createContext } from '@dotdo/do/context'

// Create $ context
const context = createContext(state, env)

// Create MCP server
const server = createMCPServer({ name: 'my-mcp', version: '1.0.0' })

// Add sandbox tool
const sandboxTool = createSandboxTool({ context })
server.addTool(sandboxTool)

// Execute code with $ context
const request = new Request('http://localhost/mcp/tools/call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'sandbox',
    arguments: {
      code: `
        $.send({ type: 'User.created', payload: { id: 1 } })
        await $.try(async () => 'single attempt')
        await $.do(async () => 'with retries')
        return 'workflow complete'
      `,
      timeout: 5000,
      permissions: {
        allowSend: true,
        allowTry: true,
        allowDo: true,
        allowOn: true,
        allowEvery: true
      },
      audit: true
    }
  })
})

const response = await server.fetch(request)
```

#### Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `code` | string | JavaScript/TypeScript code to execute | (required) |
| `timeout` | number | Timeout in milliseconds (max: 30000) | 5000 |
| `permissions` | object | Permission flags for $ context operations | all enabled |
| `resourceLimits` | object | Resource limits (maxCodeSize, maxOutputSize) | defaults |
| `audit` | boolean | Enable audit logging | false |

#### Permissions

Control what $ context operations are allowed:

```typescript
{
  allowSend: boolean   // $.send() - fire-and-forget events
  allowTry: boolean    // $.try() - single attempt operations
  allowDo: boolean     // $.do() - durable operations with retries
  allowOn: boolean     // $.on - event handlers
  allowEvery: boolean  // $.every - scheduling DSL
}
```

#### Response

```typescript
interface SandboxResult {
  success: boolean
  value?: unknown           // Return value from code
  error?: string            // Error message if failed
  duration: number          // Execution time in ms
  logs?: Array<{ level: string; message: string; args: unknown[] }>
  resourceUsage?: {
    executionTime: number
    codeSize: number
    timedOut: boolean
    outputTruncated: boolean
  }
  auditLog?: unknown[]      // $ operations log (if audit: true)
}
```

#### Examples

```typescript
// Basic execution
await sandboxTool.execute({ code: 'return 1 + 1' })

// With $ context operations
await sandboxTool.execute({
  code: `
    $.send({ type: 'Order.placed', payload: { orderId: 'ord-123' } })
    return 'order event sent'
  `
})

// Read-only mode (no event emission)
await sandboxTool.execute({
  code: 'return $.send ? "has send" : "no send"',
  permissions: { allowSend: false }
})

// With audit logging
await sandboxTool.execute({
  code: `
    $.send({ type: 'Audit.test' })
    return 'logged'
  `,
  audit: true
})
// Result includes auditLog array with operation details
```

## Tool Discovery

Tools can be registered dynamically and discovered via the ToolRegistry:

```typescript
import { ToolRegistry, ToolCategory, createSandboxTool } from '@dotdo/mcp'

const registry = new ToolRegistry()

// Register with category and capabilities
const sandboxTool = createSandboxTool({ context })
registry.register(sandboxTool, ToolCategory.COMPUTE, ['sandbox', 'isolation', 'workflow'])

// Discover tools
registry.list()                              // All tools
registry.listByCategory(ToolCategory.DATA)   // Data tools only
registry.listByCapability('sandbox')         // Tools with sandbox capability

// Tool metadata (for MCP protocol)
registry.listMetadata()                      // Tool definitions without execute

// Events
registry.on('tool:registered', (name) => console.log(`Tool registered: ${name}`))
registry.on('tool:unregistered', (name) => console.log(`Tool removed: ${name}`))
```

## Status

See beads issues do-7rf.2.* for implementation progress.

- [x] do-7rf.2.2 - search tool implementation
- [x] do-7rf.2.3 - fetch tool implementation
- [x] do-7rf.2.4 - do tool implementation
- [x] do-7rf.2.5 - sandbox tool with security
- [x] do-7rf.2.6 - tool discovery and registration

## Related

- [MCP Specification](https://modelcontextprotocol.org)
- [@dotdo/db](../db) - Storage layer
- [CLAUDE.md](../CLAUDE.md) - Project documentation
