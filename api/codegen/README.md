# API Code Generation

This directory contains code generators for the `@dotdo/api` package. These generators create various outputs from resource definitions.

## Generators

### CLI Generator (`cli.ts`)

Generates CLI commands from API resource definitions.

**Features:**
- Automatic CRUD command generation (list, get, create, update, delete)
- Custom action commands from resource definitions
- Relation commands for nested resources
- Multiple output formats (JSON, table, YAML)
- Help text and usage examples
- TypeScript code generation
- Field-based argument parsing

**Usage:**

```typescript
import { generateCLI } from './codegen/cli'
import { Customer } from './resources'

// Generate CLI structure
const cli = generateCLI([Customer])

// Generate TypeScript code
const code = generateCLI([Customer], { format: 'typescript' })

// Custom configuration
const customCLI = generateCLI([Customer], {
  format: 'typescript',
  baseUrl: 'https://api.myapp.com',
  commandPrefix: 'myapp'
})
```

**Generated Commands:**

```bash
# CRUD operations
dotdo customers list [--format json|table|yaml] [--limit N] [--offset N]
dotdo customers get <id> [--format json|table|yaml]
dotdo customers create --name <value> --email <value> [--plan <value>]
dotdo customers update <id> [--name <value>] [--email <value>]
dotdo customers delete <id> [--force]

# Custom actions
dotdo customers upgrade <id>
dotdo customers downgrade <id>

# Relations
dotdo customers orders <customerId>
```

### SDK Generator (`sdk.ts`)

Generates TypeScript SDK from API resources.

### MCP Generator (`mcp.ts`)

Generates Model Context Protocol tools from API resources.

**Features:**
- Automatic CRUD tool generation (create, get, update, delete, list)
- Custom action tools from resource definitions
- JSON Schema input validation
- LLM-friendly semantic descriptions
- MCP-compliant tool definitions
- Type-safe tool handlers

**Usage:**

```typescript
import { generateMCPTools, generateMCPServerConfig } from '@dotdo/api'
import { defineResource } from '@dotdo/api'

// Define resources
const Customer = defineResource('Customer')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', required: true, format: 'email' }
  })
  .actions({
    upgrade: {
      method: 'POST',
      handler: async (ctx) => ({ upgraded: true })
    }
  })
  .build()

// Generate MCP tools
const tools = generateMCPTools([Customer])

// Generate complete MCP server configuration
const config = generateMCPServerConfig([Customer], {
  name: 'my-api',
  version: '1.0.0'
})
```

**Generated Tools:**

```json
{
  "name": "customer_create",
  "description": "Create a new customer in the system",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "The name field" },
      "email": { "type": "string", "description": "The email field" }
    },
    "required": ["name", "email"]
  }
}
```

**Tool Naming Convention:**

- CRUD operations: `{resource}_{action}` (e.g., `customer_create`, `order_get`)
- Custom actions: `{resource}_{action}` (e.g., `customer_upgrade`)

**Integration with MCP Server:**

```typescript
import { createMCPServer } from '@dotdo/mcp'
import { generateMCPTools } from '@dotdo/api'

const tools = generateMCPTools([Customer, Order])
const server = createMCPServer({ name: 'my-api', version: '1.0.0' })

tools.forEach(tool => server.addTool(tool))

export default { fetch: server.fetch }
```

## Implementation Notes

### TDD Approach

The CLI generator was implemented using Test-Driven Development:

1. **Red**: Created failing tests first (`api/tests/cli-gen.test.ts`)
2. **Green**: Implemented minimal code to make tests pass
3. **Refactor**: Cleaned up implementation

### Test Coverage

The CLI generator has comprehensive test coverage (29 tests):

- ✓ Command generation from resources
- ✓ CRUD subcommand generation
- ✓ Custom action commands
- ✓ Relation commands
- ✓ Argument parsing from fields
- ✓ Required/optional field handling
- ✓ Type system (string, number, boolean, enum)
- ✓ Enum choices extraction
- ✓ Help text generation
- ✓ Usage examples
- ✓ Output format options (JSON, table, YAML)
- ✓ TypeScript code generation
- ✓ JSON structure output
- ✓ Configuration options (baseUrl, commandPrefix)
- ✓ ID parameter handling
- ✓ Nested relation commands

## Examples

See `cli.example.ts` for complete usage examples.

## Architecture

The CLI generator follows a functional approach:

```
ResourceDefinition[]
  → generateCLI()
    → generateResourceCommand()
      → generateListCommand()
      → generateGetCommand()
      → generateCreateCommand()
      → generateUpdateCommand()
      → generateDeleteCommand()
      → generateActionCommand()
      → generateRelationCommand()
    → generateTypeScriptCode()
  → CLIStructure | string
```

## Integration

The CLI generator integrates with:

- **dotdo CLI framework** (`dotdo/cli.ts`) - Uses `commander` for command structure
- **Resource definitions** (`api/resource.ts`) - Consumes `ResourceDefinition` interface
- **Zod schemas** - Extracts enum choices and field types

## Future Enhancements

- Interactive mode with prompts for required fields
- Piping support (stdin/stdout)
- Shell completions generation (bash, zsh, fish)
- Command aliases
- Batch operations
- Transaction support
- Watch mode for resource file changes
- Plugin system for custom formatters

## Related

- `do-7rf.7.6` - CLI command generation (this implementation)
- `do-7rf.7.5` - SDK code generation
- `do-7rf.7.4` - Resource definition DSL
- `do-7rf.7.3` - OpenAPI generation
