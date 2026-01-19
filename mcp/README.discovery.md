# MCP Tool Discovery

Tool discovery and listing for `@dotdo/mcp` package. Provides a registry for managing, categorizing, and discovering MCP tools with full metadata support.

## Features

- **Dynamic Tool Registration** - Register/unregister tools at runtime
- **Tool Categorization** - Organize tools by category (DATA, COMPUTE, GENERAL)
- **Capability Negotiation** - Query tools by capabilities
- **LLM-Friendly Metadata** - Rich descriptions and schemas for AI agents
- **Event System** - Listen for tool registration/unregistration events
- **Export/Import** - Serialize tool definitions to/from JSON

## Usage

### Basic Registration

```typescript
import { ToolRegistry, ToolCategory } from '@dotdo/mcp'
import { createSearchTool } from '@dotdo/mcp'
import { createThingsStore } from '@dotdo/db'

// Create a registry
const registry = new ToolRegistry()

// Register a tool
const store = createThingsStore()
const searchTool = createSearchTool(store)
registry.register(searchTool, ToolCategory.DATA)

// List all tools
const tools = registry.list()
console.log(`Registered tools: ${tools.length}`)
```

### Tool Metadata

```typescript
// Get tool metadata (without execute function)
const metadata = registry.getMetadata('search')
console.log(metadata)
// {
//   name: 'search',
//   description: 'Search for Things in the Digital Object store...',
//   inputSchema: { type: 'object', properties: { ... } }
// }

// List all metadata
const allMetadata = registry.listMetadata()
```

### Categorization

```typescript
import { ToolCategory } from '@dotdo/mcp'

// Register with category
registry.register(searchTool, ToolCategory.DATA)
registry.register(fetchTool, ToolCategory.DATA)
registry.register(doTool, ToolCategory.COMPUTE)

// Get tools by category
const dataTools = registry.listByCategory(ToolCategory.DATA)
const computeTools = registry.listByCategory(ToolCategory.COMPUTE)

// Get tool's category
const category = registry.getCategory('search') // 'data'
```

### Capabilities

```typescript
// Register with capabilities
registry.register(searchTool, ToolCategory.DATA, ['streaming', 'pagination'])

// Check capability
if (registry.hasCapability('search', 'streaming')) {
  console.log('Search tool supports streaming')
}

// List tools by capability
const streamingTools = registry.listByCapability('streaming')
```

### Event Handlers

```typescript
// Listen for tool registration
registry.on('tool:registered', (toolName) => {
  console.log(`Tool registered: ${toolName}`)
})

// Listen for unregistration
registry.on('tool:unregistered', (toolName) => {
  console.log(`Tool unregistered: ${toolName}`)
})

// Register tool (triggers event)
registry.register(myTool)
```

### Integration with MCP Server

```typescript
import { createMCPServer, ToolRegistry } from '@dotdo/mcp'

// Create server with registry
const registry = new ToolRegistry()
const server = createMCPServer({
  name: 'my-mcp-server',
  version: '1.0.0',
  registry
})

// Adding tools auto-registers them
server.addTool(searchTool)
server.addTool(fetchTool)

// Tools are available in both server and registry
console.log(`Server tools: ${server.tools.length}`)
console.log(`Registry tools: ${registry.list().length}`)
```

## Tool Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| `DATA` | Search, fetch, query operations | search, fetch |
| `COMPUTE` | Execute, evaluate, process | do (sandbox) |
| `GENERAL` | Uncategorized tools | Default |

## API Reference

### ToolRegistry

#### Methods

- `register(tool, category?, capabilities?)` - Register a new tool
- `unregister(name)` - Remove a tool by name
- `get(name)` - Get tool by name
- `list()` - List all registered tools
- `getMetadata(name)` - Get tool metadata (no execute function)
- `listMetadata()` - List all tools metadata
- `getCategory(name)` - Get tool's category
- `listByCategory(category)` - List tools by category
- `getCapabilities(name)` - Get tool's capabilities
- `hasCapability(name, capability)` - Check if tool has capability
- `listByCapability(capability)` - List tools by capability
- `export()` - Export tool definitions to JSON
- `on(event, handler)` - Register event handler

#### Events

- `tool:registered` - Fired when tool is registered
- `tool:unregistered` - Fired when tool is unregistered

## Testing

All features are fully tested with 27 passing tests. See `mcp/tests/discovery.test.ts` for examples.

```bash
npm test -- mcp/tests/discovery.test.ts
```

## LLM-Friendly Descriptions

The registry ensures all tool descriptions are optimized for AI agents:

- Clear action verbs (Search, Fetch, Execute, etc.)
- Comprehensive parameter descriptions
- Valid JSON Schema for all inputSchema
- Examples and constraints in schema
- Detailed error messages

## Export/Import

```typescript
// Export tool definitions
const definitions = registry.export()
console.log(JSON.stringify(definitions, null, 2))

// Example output:
// [
//   {
//     "name": "search",
//     "description": "Search for Things...",
//     "inputSchema": { "type": "object", ... },
//     "category": "data",
//     "capabilities": ["streaming", "pagination"]
//   }
// ]
```

## Implementation

The ToolRegistry is implemented in `mcp/discovery.ts` following TDD Red-Green-Refactor:

1. **Red** - 27 failing tests written first in `mcp/tests/discovery.test.ts`
2. **Green** - Implementation to make all tests pass
3. **Refactor** - Clean, documented code with full TypeScript types

## Related

- [MCP Server](./server.ts) - Main MCP server implementation
- [Search Tool](./search.ts) - Search tool with full metadata
- [MCP Protocol](https://modelcontextprotocol.io) - Model Context Protocol spec
