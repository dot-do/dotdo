# MCP Tool Generation

The `@dotdo/api` package can automatically generate Model Context Protocol (MCP) tools from your resource definitions, enabling AI agents to interact with your API.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Generated Tools](#generated-tools)
- [Tool Schema Structure](#tool-schema-structure)
- [Custom Actions](#custom-actions)
- [MCP Server Configuration](#mcp-server-configuration)
- [Integration Examples](#integration-examples)
- [Advanced Usage](#advanced-usage)
- [Best Practices](#best-practices)

## Overview

MCP (Model Context Protocol) is an open protocol that enables AI models to interact with external tools and services. The `@dotdo/api` package generates MCP-compliant tool definitions from your resource definitions, providing:

- Automatic CRUD tool generation for each resource
- Custom action tools from resource action definitions
- JSON Schema input validation
- Semantic descriptions for LLM understanding

## Quick Start

### 1. Define Resources

```typescript
import { defineResource } from '@dotdo/api'

const CustomerResource = defineResource('customers')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email', required: true },
    plan: { type: 'enum', values: ['free', 'pro', 'enterprise'] }
  })
  .actions({
    upgrade: { method: 'POST', handler: async (ctx) => ({ success: true }) }
  })
  .build()

const OrderResource = defineResource('orders')
  .fields({
    customerId: { type: 'string', required: true },
    total: { type: 'number', required: true },
    status: { type: 'enum', values: ['pending', 'completed', 'cancelled'] }
  })
  .build()
```

### 2. Generate MCP Tools

```typescript
import { generateMCPTools, generateMCPServerConfig } from '@dotdo/api'

// Generate tools array
const tools = generateMCPTools([CustomerResource, OrderResource])

console.log(tools)
// [
//   { name: 'customers_create', description: 'Create a new customer', ... },
//   { name: 'customers_get', description: 'Get a customer by ID', ... },
//   { name: 'customers_update', description: 'Update an existing customer', ... },
//   { name: 'customers_delete', description: 'Delete a customer by ID', ... },
//   { name: 'customers_list', description: 'List all customers with optional filters', ... },
//   { name: 'customers_upgrade', description: 'Perform upgrade action on customer', ... },
//   { name: 'orders_create', ... },
//   ...
// ]
```

### 3. Create MCP Server

```typescript
const serverConfig = generateMCPServerConfig(
  [CustomerResource, OrderResource],
  {
    name: 'my-api-mcp',
    version: '1.0.0'
  }
)

// serverConfig can be used to initialize an MCP server
```

## Generated Tools

For each resource, the following tools are automatically generated:

### CRUD Operations

| Tool Name | Description | Input Schema |
|-----------|-------------|--------------|
| `{resource}_create` | Create a new resource | All required fields |
| `{resource}_get` | Get a resource by ID | `{ id: string }` |
| `{resource}_update` | Update an existing resource | `{ id: string, ...fields }` |
| `{resource}_delete` | Delete a resource by ID | `{ id: string }` |
| `{resource}_list` | List resources with filters | `{ limit?: number, offset?: number }` |

### Example Tool Output

```typescript
// Generated customers_create tool
{
  name: 'customers_create',
  description: 'Create a new customer in the system',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name field' },
      email: { type: 'string', description: 'The email field' },
      plan: { type: 'string', description: 'The plan field' }
    },
    required: ['name', 'email']
  }
}

// Generated customers_get tool
{
  name: 'customers_get',
  description: 'Get a customer by ID',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The customer ID' }
    },
    required: ['id']
  }
}
```

## Tool Schema Structure

Each generated tool follows the MCP tool specification:

```typescript
interface MCPTool {
  // Unique tool identifier
  name: string

  // Human-readable description for LLM understanding
  description: string

  // JSON Schema for input validation
  inputSchema: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      format?: string  // e.g., 'date-time' for dates
    }>
    required: string[]
  }

  // Optional handler function
  handler?: (params: unknown) => Promise<unknown>
}
```

### Field Type Mapping

| Resource Field Type | JSON Schema Type | Notes |
|---------------------|-----------------|-------|
| `string` | `string` | |
| `number` | `number` | |
| `boolean` | `boolean` | |
| `date` | `string` | With `format: 'date-time'` |
| `array` | `array` | |
| `object` | `object` | |
| `enum` | `string` | With enum values in description |

## Custom Actions

Resource actions are automatically converted to MCP tools:

### Defining Actions

```typescript
const CustomerResource = defineResource('customers')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    plan: { type: 'enum', values: ['free', 'pro', 'enterprise'] }
  })
  .actions({
    upgrade: {
      method: 'POST',
      handler: async (ctx) => {
        const { plan } = await ctx.req.json()
        // Upgrade logic
        return { success: true, newPlan: plan }
      },
      description: 'Upgrade customer to a higher plan'
    },
    suspend: {
      method: 'POST',
      handler: async (ctx) => {
        // Suspend logic
        return { suspended: true }
      },
      description: 'Temporarily suspend customer account'
    }
  })
  .build()
```

### Generated Action Tools

```typescript
// customers_upgrade tool
{
  name: 'customers_upgrade',
  description: 'Perform upgrade action on customer',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name field' },
      email: { type: 'string', description: 'The email field' },
      plan: { type: 'string', description: 'The plan field' }
    },
    required: ['name', 'email']
  }
}

// customers_suspend tool
{
  name: 'customers_suspend',
  description: 'Perform suspend action on customer',
  inputSchema: { ... }
}
```

## MCP Server Configuration

Generate complete server configuration for MCP servers:

```typescript
import { generateMCPServerConfig } from '@dotdo/api'

const config = generateMCPServerConfig(
  [CustomerResource, OrderResource, ProductResource],
  {
    name: 'ecommerce-api',
    version: '2.0.0'
  }
)

// config structure:
// {
//   name: 'ecommerce-api',
//   version: '2.0.0',
//   tools: [
//     { name: 'customers_create', ... },
//     { name: 'customers_get', ... },
//     ...
//   ]
// }
```

## Integration Examples

### With Claude Desktop

The `@dotdo/mcp` package provides a standalone MCP server that can be used directly with Claude Desktop. This enables Claude to interact with your dotdo-based applications.

#### Quick Setup

1. **Configure Claude Desktop**

   Edit your Claude Desktop configuration file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/claude/claude_desktop_config.json`

   Add the dotdo MCP server:

   ```json
   {
     "mcpServers": {
       "dotdo": {
         "command": "npx",
         "args": ["@dotdo/mcp"]
       }
     }
   }
   ```

2. **Restart Claude Desktop**

   After saving the configuration, restart Claude Desktop to load the MCP server.

3. **Verify the Connection**

   Ask Claude: "What MCP tools do you have available?" Claude should list the dotdo tools.

#### Available Tools

The `@dotdo/mcp` server exposes three core tools:

| Tool | Description | Use Cases |
|------|-------------|-----------|
| **search** | Search Things in the Digital Object store | Find entities by type, filter by fields, full-text search |
| **fetch** | Fetch content from web URLs | Get data from APIs, scrape web pages |
| **do** | Execute code in a secure sandbox | Run JavaScript with timeout and memory limits |

#### Tool Input Schemas

**search tool:**
```json
{
  "$type": "User",
  "where": { "role": "admin" },
  "query": "john",
  "orderBy": "createdAt",
  "order": "desc",
  "limit": 10,
  "offset": 0,
  "select": ["name", "email"]
}
```

**fetch tool:**
```json
{
  "url": "https://api.example.com/users",
  "method": "GET",
  "headers": { "Authorization": "Bearer token" }
}
```

**do tool:**
```json
{
  "code": "const x = 1 + 1; return x;",
  "timeout": 5000
}
```

#### Example Conversation with Claude

Here's an example of how Claude can use dotdo MCP tools:

**User:** "Find all admin users in the system and show their emails"

**Claude (internally calls):**
```json
{
  "tool": "search",
  "arguments": {
    "$type": "User",
    "where": { "role": "admin" },
    "select": ["name", "email"]
  }
}
```

**Claude (response):** "I found 3 admin users:
- Alice (alice@example.com)
- Bob (bob@example.com)
- Charlie (charlie@example.com)"

---

**User:** "Calculate the total order value for customer cust-123"

**Claude (internally calls):**
```json
{
  "tool": "do",
  "arguments": {
    "code": "const orders = await $.things.list({ type: 'Order', where: { customerId: 'cust-123' } }); return orders.reduce((sum, o) => sum + o.total, 0);"
  }
}
```

**Claude (response):** "The total order value for customer cust-123 is $1,547.50"

#### Advanced: Custom MCP Server with Resources

For full control, create a custom MCP server configuration:

```typescript
// mcp-server.ts
import { generateMCPServerConfig } from '@dotdo/api'
import { resources } from './resources'

const config = generateMCPServerConfig(resources, {
  name: 'my-api',
  version: '1.0.0'
})

// Export for MCP server runtime
export default {
  name: config.name,
  version: config.version,
  tools: config.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    execute: async (params: Record<string, unknown>) => {
      // Connect to your actual API
      const response = await fetch(`https://api.example.com/${tool.name}`, {
        method: 'POST',
        body: JSON.stringify(params)
      })
      return response.json()
    }
  }))
}
```

#### Running as HTTP Server

For debugging or external access, run the MCP server in HTTP mode:

```bash
# Start HTTP server on default port 3000
npx @dotdo/mcp --http

# Start on custom port
npx @dotdo/mcp --http --port 8080

# With verbose logging
npx @dotdo/mcp --http --verbose
```

HTTP endpoints:
- `POST /mcp/initialize` - Initialize the MCP server
- `GET /mcp/tools` - List available tools
- `POST /mcp/tools/call` - Execute a tool
- `GET /` - Health check

Example HTTP call:
```bash
curl -X POST http://localhost:3000/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "search",
    "arguments": {
      "$type": "User",
      "limit": 5
    }
  }'
```
```

### With Cloudflare Workers

```typescript
// worker.ts
import { generateMCPTools } from '@dotdo/api'
import { resources } from './resources'

const tools = generateMCPTools(resources)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // MCP tool discovery endpoint
    if (url.pathname === '/mcp/tools') {
      return Response.json({
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      })
    }

    // MCP tool execution endpoint
    if (url.pathname.startsWith('/mcp/execute/')) {
      const toolName = url.pathname.replace('/mcp/execute/', '')
      const tool = tools.find(t => t.name === toolName)

      if (!tool) {
        return Response.json({ error: 'Tool not found' }, { status: 404 })
      }

      const params = await request.json()

      // Execute tool handler
      if (tool.handler) {
        const result = await tool.handler(params)
        return Response.json(result)
      }

      return Response.json({ error: 'No handler' }, { status: 501 })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}
```

### With AI Agents

```typescript
import { generateMCPTools } from '@dotdo/api'
import { ai } from '@dotdo/ai'

const tools = generateMCPTools([CustomerResource, OrderResource])

// Format tools for AI system prompt
const toolDescriptions = tools.map(tool =>
  `${tool.name}: ${tool.description}\n` +
  `Input: ${JSON.stringify(tool.inputSchema, null, 2)}`
).join('\n\n')

// Use in AI prompt
const response = await ai`
You have access to the following tools:

${toolDescriptions}

User request: Find customer John Smith and upgrade their plan to enterprise.

Respond with the tool calls needed in JSON format.
`
```

## Advanced Usage

### MCPGenerator Class

For more control, use the `MCPGenerator` class directly:

```typescript
import { MCPGenerator } from '@dotdo/api/codegen/mcp'

const generator = new MCPGenerator()

// Generate all tools
const tools = generator.generateTools([CustomerResource, OrderResource])

// Generate single resource tools
const customerTools = generator.generateTools([CustomerResource])

// Convert resource to input schema
const schema = generator.resourceToInputSchema(CustomerResource)

// Generate tool description
const description = generator.generateDescription('Customer', 'create')
```

### Custom Tool Handlers

Override default handlers with real API implementations:

```typescript
import { generateMCPTools } from '@dotdo/api'

const tools = generateMCPTools([CustomerResource])

// Replace mock handlers with real implementations
const apiClient = createClient({ baseUrl: 'https://api.example.com.ai' })

tools.forEach(tool => {
  const [resource, operation] = tool.name.split('_')

  tool.handler = async (params) => {
    switch (operation) {
      case 'create':
        return apiClient[resource].create(params)
      case 'get':
        return apiClient[resource].get(params.id)
      case 'update':
        return apiClient[resource].update(params.id, params)
      case 'delete':
        return apiClient[resource].delete(params.id)
      case 'list':
        return apiClient[resource].list(params)
      default:
        // Custom action
        return apiClient[resource](params.id)[operation](params)
    }
  }
})
```

### Filtering Tools

Generate tools for specific operations only:

```typescript
const allTools = generateMCPTools([CustomerResource, OrderResource])

// Only CRUD tools (no custom actions)
const crudTools = allTools.filter(t =>
  ['_create', '_get', '_update', '_delete', '_list'].some(op =>
    t.name.endsWith(op)
  )
)

// Only read operations
const readTools = allTools.filter(t =>
  t.name.endsWith('_get') || t.name.endsWith('_list')
)

// Only customer tools
const customerTools = allTools.filter(t => t.name.startsWith('customers_'))
```

## Best Practices

### 1. Use Descriptive Field Names

Field names become tool parameter names and descriptions:

```typescript
// Good - clear parameter names
const Resource = defineResource('orders')
  .fields({
    customerId: { type: 'string', required: true },
    orderTotal: { type: 'number', required: true },
    shippingAddress: { type: 'string' }
  })

// Bad - ambiguous names
const Resource = defineResource('orders')
  .fields({
    cid: { type: 'string', required: true },
    amt: { type: 'number', required: true },
    addr: { type: 'string' }
  })
```

### 2. Mark Required Fields

Required fields are enforced in the tool schema:

```typescript
const Resource = defineResource('customers')
  .fields({
    name: { type: 'string', required: true },   // In required[]
    email: { type: 'string', required: true },  // In required[]
    phone: { type: 'string' }                   // Optional
  })
```

### 3. Use Enums for Constrained Values

```typescript
const Resource = defineResource('orders')
  .fields({
    status: {
      type: 'enum',
      values: ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
    }
  })
```

### 4. Add Action Descriptions

```typescript
const Resource = defineResource('orders')
  .actions({
    cancel: {
      method: 'POST',
      handler: async (ctx) => { ... },
      description: 'Cancel an order and initiate refund process'  // Helps LLM understand
    }
  })
```

### 5. Validate Inputs

The generated tools include JSON Schema validation:

```typescript
const tool = tools.find(t => t.name === 'customers_create')

// Use schema for validation before calling handler
const ajv = new Ajv()
const validate = ajv.compile(tool.inputSchema)

if (!validate(userInput)) {
  throw new Error(`Invalid input: ${JSON.stringify(validate.errors)}`)
}

const result = await tool.handler(userInput)
```

## File Locations

| File | Description |
|------|-------------|
| `/Users/nathanclevenger/projects/dotdo/api/codegen/mcp.ts` | MCP generator implementation |
| `/Users/nathanclevenger/projects/dotdo/api/resource.ts` | Resource definition DSL |
| `/Users/nathanclevenger/projects/dotdo/api/tests/mcp-gen.test.ts` | MCP generation tests |
| `/Users/nathanclevenger/projects/dotdo/mcp/` | Full MCP server implementation |

## Related Documentation

- [SDK Generation](./SDK_GENERATION.md) - TypeScript SDK generation
- [HATEOAS API](./HATEOAS_API.md) - Self-describing API patterns
- [AI Module](./AI_MODULE.md) - AI routing and template literals
