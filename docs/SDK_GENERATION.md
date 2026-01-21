# SDK Generation from HATEOAS API

This document describes how to generate TypeScript SDKs from the dotdo self-describing HATEOAS API. The SDK generation system follows the principle of "Define once, generate everywhere" - your API definitions automatically produce SDK clients, CLI commands, and MCP tools.

## Overview

The `@dotdo/api` package provides comprehensive code generation capabilities:

| Generator | Purpose | Output |
|-----------|---------|--------|
| `generateSDK()` | TypeScript SDK client | Type-safe API client with CRUD + custom actions |
| `generateOpenAPI()` | OpenAPI 3.0 specification | JSON/YAML spec for documentation |
| `generateCLI()` | CLI command structure | Commander.js compatible commands |
| `generateMCPTools()` | MCP tools | AI-agent compatible tool definitions |

## Quick Start

### 1. Define Resources

First, define your API resources using the fluent `defineResource` builder:

```typescript
import { defineResource } from '@dotdo/api'

// Define a Customer resource
const CustomerResource = defineResource('customers')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email', required: true },
    plan: { type: 'enum', values: ['free', 'pro', 'enterprise'] }
  })
  .relations({
    orders: { type: 'hasMany', resource: 'orders' }
  })
  .actions({
    upgrade: { method: 'POST', handler: async (ctx) => ({}) },
    downgrade: { method: 'POST', handler: async (ctx) => ({}) }
  })
  .build()

const OrderResource = defineResource('orders')
  .fields({
    customerId: { type: 'string', required: true },
    total: { type: 'number', required: true },
    status: { type: 'enum', values: ['pending', 'completed', 'cancelled'] }
  })
  .relations({
    customer: { type: 'belongsTo', resource: 'customers' }
  })
  .build()
```

### 2. Generate SDK

Generate a TypeScript SDK from your resource definitions:

```typescript
import { generateSDK } from '@dotdo/api'

const sdkCode = generateSDK([CustomerResource, OrderResource])

// Write to file
import { writeFileSync } from 'fs'
writeFileSync('sdk.ts', sdkCode)
```

### 3. Use Generated SDK

The generated SDK provides a type-safe client:

```typescript
import { createClient } from './sdk'

const client = createClient({
  baseUrl: 'https://api.example.com',
  apiKey: 'your-api-key'
})

// CRUD operations
const customers = await client.customers.list()
const customer = await client.customers.get('cust-123')
const newCustomer = await client.customers.create({ name: 'Alice', email: 'alice@example.com' })
await client.customers.update('cust-123', { plan: 'pro' })
await client.customers.delete('cust-123')

// Access by ID with instance methods
const cust = await client.customers('cust-123').get()
await client.customers('cust-123').update({ name: 'Alice Updated' })

// Relations
const orders = await client.customers('cust-123').orders.list()
const owner = await client.orders('ord-456').customer.get()

// Custom actions
await client.customers('cust-123').upgrade({ plan: 'enterprise' })
```

## HATEOAS Link to SDK Method Mapping

The SDK generation maps HATEOAS links to SDK methods following RESTful conventions:

### Standard Links

| HATEOAS Link | SDK Method | HTTP | Description |
|--------------|------------|------|-------------|
| `self` | `resource(id).get()` | GET | Get single resource |
| `collection` | `resource.list()` | GET | List all resources |
| `create` | `resource.create(data)` | POST | Create new resource |
| `update` | `resource(id).update(data)` | PUT | Update existing resource |
| `delete` | `resource(id).delete()` | DELETE | Delete resource |

### Relation Links

| HATEOAS Link | SDK Method | Type | Description |
|--------------|------------|------|-------------|
| `{relation}` (hasMany) | `resource(id).{relation}.list()` | GET | List related resources |
| `{relation}` (belongsTo) | `resource(id).{relation}.get()` | GET | Get parent resource |
| `{relation}` (hasOne) | `resource(id).{relation}.get()` | GET | Get associated resource |

### Custom Action Links

| HATEOAS Link | SDK Method | Default HTTP | Description |
|--------------|------------|--------------|-------------|
| `{action}` | `resource(id).{action}(params)` | POST | Execute custom action |

## Generated Code Structure

### Type Interfaces

The SDK generates TypeScript interfaces from your resource fields:

```typescript
// Generated from CustomerResource
export interface Customer {
  $id: string
  name: string
  email: string
  plan?: 'free' | 'pro' | 'enterprise'
}
```

### Client Factory

The `createClient` function returns a fully typed client:

```typescript
export interface ClientOptions {
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
}

export function createClient(options: ClientOptions) {
  // Returns typed resource accessors
  return {
    customers: {
      list: async (): Promise<Customer[]> => { ... },
      get: async (id: string): Promise<Customer> => { ... },
      create: async (data: Omit<Customer, '$id'>): Promise<Customer> => { ... },
      update: async (id: string, data: Partial<Omit<Customer, '$id'>>): Promise<Customer> => { ... },
      delete: async (id: string): Promise<void> => { ... },
      // Plus: customers(id) returns instance methods
    },
    orders: { ... }
  }
}
```

### Error Handling

The generated SDK includes an `APIError` class:

```typescript
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message)
    this.name = 'APIError'
  }
}
```

## Advanced Usage

### SDK Generator Options

```typescript
import { generateSDK, type SDKGeneratorOptions } from '@dotdo/api'

const options: SDKGeneratorOptions = {
  output: 'string',      // 'string' or 'file'
  filePath: './sdk.ts',  // If output is 'file'
  includeJSDoc: true     // Include JSDoc comments
}

const sdk = generateSDK(resources, options)
```

### Direct SDK Generator Access

For more control, use the `SDKGenerator` class directly:

```typescript
import { SDKGenerator } from '@dotdo/api/codegen/sdk'

const generator = new SDKGenerator(resources)

// Generate individual parts
const types = generator.generateTypes()
const client = generator.generateClient()
const methods = generator.generateMethods(resource)

// Or generate complete SDK
const fullSdk = generator.generate()
```

## OpenAPI Integration

The SDK can also be generated from an OpenAPI specification:

### Generate OpenAPI from Resources

```typescript
import { generateOpenAPI, addOpenAPIEndpoints } from '@dotdo/api'
import { Hono } from 'hono'

const app = new Hono()

// Add OpenAPI endpoints
addOpenAPIEndpoints(app, {
  resources: [CustomerResource, OrderResource],
  info: {
    title: 'My API',
    version: '1.0.0'
  },
  docsPath: '/docs',      // Swagger UI
  jsonPath: '/openapi.json',
  yamlPath: '/openapi.yaml'
})
```

### Endpoints Added

| Path | Description |
|------|-------------|
| `/docs` | Interactive Swagger UI documentation |
| `/openapi.json` | OpenAPI 3.0 specification (JSON) |
| `/openapi.yaml` | OpenAPI 3.0 specification (YAML) |

## CLI Generation

Generate CLI commands from resource definitions:

```typescript
import { generateCLI } from '@dotdo/api/codegen/cli'

const cliStructure = generateCLI([CustomerResource, OrderResource], {
  baseUrl: 'https://api.example.com',
  commandPrefix: 'myapp'
})

// Or generate TypeScript code
const cliCode = generateCLI(resources, { format: 'typescript' })
```

Generated commands follow this pattern:
```bash
myapp customers list [--format json|table|yaml]
myapp customers get <id>
myapp customers create --name "Alice" --email "alice@example.com"
myapp customers update <id> --plan pro
myapp customers delete <id> [--force]
myapp customers upgrade <id>
myapp customers orders <customerId>
```

## MCP Tools Generation

Generate Model Context Protocol tools for AI agents:

```typescript
import { generateMCPTools, generateMCPServerConfig } from '@dotdo/api'

// Generate tools array
const tools = generateMCPTools([CustomerResource, OrderResource])

// Or complete server config
const serverConfig = generateMCPServerConfig(resources, {
  name: 'my-api-mcp',
  version: '1.0.0'
})
```

Each resource generates these MCP tools:
- `{resource}_create` - Create a new resource
- `{resource}_get` - Get a resource by ID
- `{resource}_update` - Update a resource
- `{resource}_delete` - Delete a resource
- `{resource}_list` - List all resources
- `{resource}_{action}` - Custom action tools

## Architecture

The code generation system uses a layered architecture:

```
Resource Definitions (defineResource)
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
    OpenAPI Spec                          Direct SDK Gen
   (generateOpenAPI)                    (SDKGenerator)
         │                                      │
         │                                      │
         ▼                                      ▼
    SDK from OpenAPI                      TypeScript SDK
  (generateSDKFromOpenAPI)              (sdk.ts output)
         │
         │
         ▼
    CLI / MCP Tools
```

## File Locations

| File | Description |
|------|-------------|
| `/Users/nathanclevenger/projects/dotdo/api/resource.ts` | Resource definition DSL |
| `/Users/nathanclevenger/projects/dotdo/api/hateoas.ts` | HATEOAS link generation |
| `/Users/nathanclevenger/projects/dotdo/api/openapi.ts` | OpenAPI 3.0 generation |
| `/Users/nathanclevenger/projects/dotdo/api/codegen/sdk.ts` | TypeScript SDK generator |
| `/Users/nathanclevenger/projects/dotdo/api/codegen/cli.ts` | CLI command generator |
| `/Users/nathanclevenger/projects/dotdo/api/codegen/mcp.ts` | MCP tools generator |
| `/Users/nathanclevenger/projects/dotdo/api/sdk.ts` | SDK exports |

## Examples

See the test files for comprehensive examples:
- `/Users/nathanclevenger/projects/dotdo/api/tests/sdk-gen.test.ts` - SDK generation tests
- `/Users/nathanclevenger/projects/dotdo/api/tests/sdk.test.ts` - SDK API tests
- `/Users/nathanclevenger/projects/dotdo/api/tests/cli-gen.test.ts` - CLI generation tests
- `/Users/nathanclevenger/projects/dotdo/api/tests/mcp-gen.test.ts` - MCP generation tests
- `/Users/nathanclevenger/projects/dotdo/api/tests/openapi.test.ts` - OpenAPI generation tests

## Best Practices

1. **Define resources in a shared module** - Keep resource definitions separate from your API routes for reuse across SDK, CLI, and MCP generation.

2. **Include all fields** - The SDK generator maps field types to TypeScript types. Define all fields for complete type safety.

3. **Use relations** - Define relationships between resources to enable fluent traversal in the generated SDK.

4. **Document with actions** - Custom actions appear in the SDK, CLI, and MCP tools automatically.

5. **Regenerate on changes** - Add SDK generation to your build process to keep the SDK in sync with your API.

## Troubleshooting

### Missing types in generated SDK

Ensure all fields have a `type` property:
```typescript
fields: {
  name: { type: 'string', required: true },  // Correct
  email: { required: true }                   // Missing type - will default to 'any'
}
```

### Relations not appearing in SDK

Relations need both the resource and type defined:
```typescript
relations: {
  orders: { type: 'hasMany', resource: 'orders' }  // Correct
}
```

### Actions not generated

Actions need a method and handler:
```typescript
actions: {
  upgrade: {
    method: 'POST',
    handler: async (ctx) => ({ success: true })
  }
}
```
