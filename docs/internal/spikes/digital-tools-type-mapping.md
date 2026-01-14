# SPIKE: Digital Tools Type Mapping - primitives.org.ai to dotdo

**Issue:** dotdo-v89ck
**Epic:** dotdo-2hiae (Digital Tools Graph Integration)
**Status:** Completed
**Author:** Agent
**Date:** 2026-01-13

## Overview

This spike investigates and documents how `primitives.org.ai/digital-tools` types map to dotdo's Thing/Relationship model. The goal is to identify conversion requirements, gaps, and the recommended integration strategy.

## Source Systems

### primitives.org.ai/digital-tools

Location: `/Users/nathanclevenger/projects/primitives.org.ai/packages/digital-tools/src/types.ts`

Core types:
- `Tool<TInput, TOutput>` - Primary tool definition
- `ToolCategory` / `ToolSubcategory` - Classification hierarchy
- `ToolPermission` - Access control
- `ToolContext` - Execution context
- `MCPTool` / `MCPToolCall` / `MCPToolResult` - MCP compatibility types

### dotdo Thing/Relationship Model

Location: `/Users/nathanclevenger/projects/dotdo/db/graph/types.ts`

Core types:
- `GraphThing` - Graph node (id, typeId, typeName, data, timestamps)
- `GraphRelationship` - Graph edge (id, verb, from, to, data, createdAt)
- `ToolThing` / `ToolThingData` - Tool-specific Thing type (in `types/Tool.ts`)

---

## Type Mapping Table

### Tool Definition Mapping

| primitives.org.ai | dotdo | Location | Strategy |
|-------------------|-------|----------|----------|
| `Tool.id` | `GraphThing.id` | things.id | Direct: `tool:${id}` prefix |
| `Tool.name` | `ToolThingData.name` | data.name | Direct mapping |
| `Tool.description` | `ToolThingData.description` | data.description | Direct mapping |
| `Tool.version` | `ToolThingData.version` | data.version | Direct mapping |
| `Tool.category` | `ToolThingData.category` | data.category | Direct mapping |
| `Tool.subcategory` | `ToolThingData.subcategory` | data.subcategory | Direct mapping |
| `Tool.tags` | `ToolThingData.tags` | data.tags | Direct mapping |
| `Tool.audience` | `ToolThingData.audience` | data.audience | Direct mapping |
| `Tool.securityLevel` | `ToolThingData.securityLevel` | data.securityLevel | Direct mapping |
| `Tool.parameters` | `ToolThingData.parameters` | data.parameters | **Conversion needed** |
| `Tool.output` | `ToolThingData.output` | data.output | **Conversion needed** |
| `Tool.handler` | Handler Registry | In-memory | **Cannot serialize** |
| `Tool.permissions` | Permission Things | Relationships | **Separate Things** |
| `Tool.rateLimit` | `ToolThingData.rateLimit` | data.rateLimit | Direct mapping |
| `Tool.requiresConfirmation` | `ToolThingData.requiresConfirmation` | data.requiresConfirmation | Direct mapping |
| `Tool.idempotent` | `ToolThingData.idempotent` | data.idempotent | Direct mapping |
| `Tool.estimatedDuration` | `ToolThingData.estimatedDuration` | data.estimatedDuration | Direct mapping |
| `Tool.costPerExecution` | `ToolThingData.costPerExecution` | data.costPerExecution | Direct mapping |

### Category Mapping

primitives.org.ai has 12 top-level categories:
```typescript
type ToolCategory =
  | 'communication' | 'data' | 'development' | 'documents'
  | 'finance' | 'integration' | 'knowledge' | 'media'
  | 'productivity' | 'security' | 'system' | 'web'
```

dotdo has 7 categories (in `types/Tool.ts`):
```typescript
type ToolCategory =
  | 'communication' | 'data' | 'development' | 'ai'
  | 'integration' | 'system' | 'custom'
```

**Gap Analysis:**
- Missing in dotdo: `documents`, `finance`, `knowledge`, `media`, `productivity`, `security`, `web`
- Extra in dotdo: `ai`, `custom`

**Recommendation:** Extend dotdo's `ToolCategory` to include all primitives.org.ai categories plus the dotdo-specific ones.

### Schema Handling

Both systems support:
- Zod schemas
- JSON Schema

**primitives.org.ai approach:**
```typescript
export interface ToolParameter {
  name: string
  description: string
  schema: Schema  // JSONSchema | z.ZodType
  required?: boolean
  default?: unknown
  examples?: unknown[]
}
```

**dotdo approach:**
```typescript
export interface ToolParameter {
  name: string
  type: string
  required?: boolean
  description?: string
  default?: unknown
  enum?: string[]
}
```

**Gap:** primitives.org.ai has richer parameter definitions with:
- Full schema object per parameter
- Examples array

**Conversion Strategy:**
```typescript
// primitives.org.ai ToolParameter -> dotdo ToolParameter
function convertParameter(param: PrimitivesToolParameter): DotdoToolParameter {
  const jsonSchema = isZodSchema(param.schema)
    ? zodToJsonSchema(param.schema)
    : param.schema

  return {
    name: param.name,
    type: jsonSchema.type || 'object',
    required: param.required,
    description: param.description,
    default: param.default,
    enum: jsonSchema.enum as string[] | undefined,
    // Store full schema in extension field if needed
    schema: jsonSchema
  }
}
```

---

## Relationship Mappings

### Tool Invocations as Relationships

**Design:**
```
Agent/Human --[invoke/invoking/invoked]--> Tool
```

**Relationship structure:**
```typescript
{
  id: 'inv-{ulid}',
  verb: 'invoke' | 'invoking' | 'invoked',
  from: 'do://tenant/agents/{agentId}',  // or humans/{userId}
  to: 'do://tenant/tools/{toolId}',
  data: {
    input: Record<string, unknown>,
    output?: unknown,
    duration?: number,
    cost?: number,
    error?: string,
    status: 'pending' | 'running' | 'completed' | 'failed'
  }
}
```

**Verb form transitions:**
- `invoke` -> `invoking` -> `invoked` (success)
- `invoke` -> `invoking` -> `invoked` with error data (failure)

### Tool-Provider Relationships

```
Tool --[providedBy]--> Provider
```

**Example:**
```typescript
{
  id: 'rel-tool-provider-1',
  verb: 'providedBy',
  from: 'do://tenant/tools/communication.email.send',
  to: 'do://tenant/providers/sendgrid',
  data: null
}
```

### Tool-Permission Relationships

```
Tool --[requires]--> Permission
```

**Example:**
```typescript
{
  id: 'rel-tool-perm-1',
  verb: 'requires',
  from: 'do://tenant/tools/communication.email.send',
  to: 'do://tenant/permissions/email:write',
  data: {
    scope: 'organization'
  }
}
```

### Tool-Category Relationships

```
Tool --[belongsTo]--> Category
```

**Note:** Category can also be stored directly in `data.category` for denormalization.

---

## Handler Storage Strategy

**Problem:** Function handlers cannot be serialized to JSON for graph storage.

**Solution (already implemented in dotdo):**

1. **Handler Registry** (`agents/tool-thing.ts`):
```typescript
const handlerRegistry = new Map<string, ToolHandler>()

function registerHandler(toolName: string, handler: Function): string {
  const id = `handler:${toolName}:${Date.now().toString(36)}`
  handlerRegistry.set(id, handler)
  return id
}
```

2. **ToolThingData stores handlerId:**
```typescript
interface ToolThingData {
  name: string
  description: string
  inputSchema: JsonSchema
  handlerId: string  // Reference to in-memory handler
  // ...
}
```

3. **Hybrid registry pattern:**
   - Tool metadata persisted in graph
   - Handler functions registered in memory at runtime
   - On load, tools without handlers are skipped

---

## MCP Compatibility Layer

### Existing dotdo types (`types/mcp.ts`):
- `McpTool` / `McpToolCall` / `McpToolResult` / `McpContent`
- Conversion helpers: `toolThingToMcp()`, `mcpToToolThing()`

### primitives.org.ai types:
- `MCPTool` / `MCPToolCall` / `MCPToolResult`
- Nearly identical to dotdo types

**Conversion:**
```typescript
// primitives.org.ai MCPTool -> dotdo McpTool
// Direct mapping - types are compatible
function convertMcpTool(tool: PrimitivesMCPTool): DotdoMcpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema  // JSONSchema - compatible
  }
}
```

---

## Provider Integration Strategy

### primitives.org.ai Provider Pattern

Location: `/Users/nathanclevenger/projects/primitives.org.ai/packages/digital-tools/src/providers/`

```typescript
// Example: SendGrid provider
const sendgridProvider = defineProvider(sendgridInfo, async (config) =>
  createSendGridProvider(config)
)
```

### dotdo compat/ Layer

Location: `/Users/nathanclevenger/projects/dotdo/compat/`

70+ provider implementations (sendgrid, slack, stripe, etc.)

**Recommendation:**

1. **Reuse dotdo compat/ implementations** - they're more comprehensive
2. **Wrap as Tools** for the graph registry:

```typescript
// Bridge pattern: compat/ provider -> Tool Thing
function providerToTool(providerFn: Function, toolDef: ToolDefinition): ToolThing {
  const tool = tool({
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: toolDef.inputSchema,
    execute: async (input, ctx) => providerFn(input)
  })

  return toolToThing(tool)
}
```

---

## Answers to Investigation Questions

### 1. Can Tool.handler be stored as Thing.data or needs separate storage?

**Answer:** Separate storage required.

- Handlers (functions) cannot be serialized to JSON
- dotdo already has `handlerRegistry` pattern in `agents/tool-thing.ts`
- `handlerId` stored in Thing.data references in-memory handler

### 2. How to handle Zod schemas in Thing.data?

**Answer:** Convert to JSON Schema for storage.

```typescript
import { zodToJsonSchema } from './schema'

const jsonSchema = isZodSchema(tool.inputSchema)
  ? zodToJsonSchema(tool.inputSchema)
  : tool.inputSchema

// Store jsonSchema in Thing.data.inputSchema
```

Both systems already have this pattern implemented.

### 3. Provider registry -> Graph query approach?

**Answer:** Model providers as Things, query via relationships.

```typescript
// Query all tools for a provider
const sendgridTools = await store.queryRelationshipsTo(
  'do://tenant/providers/sendgrid',
  { verb: 'providedBy' }
)

// Query provider for a tool
const provider = await store.queryRelationshipsFrom(
  'do://tenant/tools/communication.email.send',
  { verb: 'providedBy' }
)
```

---

## Implementation Recommendations

### Phase 1: Type Consolidation
1. Extend dotdo `ToolCategory` to match primitives.org.ai categories
2. Add missing parameter fields (`examples`, full `schema` object)
3. Add `ToolOutput` type for output schema handling

### Phase 2: Conversion Layer
Create `lib/tools/conversion.ts`:
```typescript
export function primitivesToolToDotdo(tool: PrimitivesTool): ToolThing { }
export function dotdoToolToPrimitives(thing: ToolThing): PrimitivesTool { }
```

### Phase 3: Provider Bridge
Create `compat/tools/bridge.ts`:
```typescript
export function compatProviderToTool(provider: CompatProvider): ToolDefinition { }
```

### Phase 4: Graph Integration
- Register all compat/ providers as Tool Things on startup
- Create relationship graph: Tool -> Provider -> Category

---

## File Locations Summary

| System | File | Purpose |
|--------|------|---------|
| primitives.org.ai | `packages/digital-tools/src/types.ts` | Core tool types |
| primitives.org.ai | `packages/digital-tools/src/define.ts` | Tool builder |
| primitives.org.ai | `packages/digital-tools/src/providers/` | Provider implementations |
| dotdo | `types/Tool.ts` | ToolThing type definitions |
| dotdo | `types/mcp.ts` | MCP types + conversion helpers |
| dotdo | `agents/Tool.ts` | tool() helper + re-exports |
| dotdo | `agents/tool-thing.ts` | Tool-Thing conversion + registry |
| dotdo | `agents/types.ts` | Agent SDK types |
| dotdo | `db/graph/types.ts` | GraphStore interface |
| dotdo | `db/graph/things.ts` | GraphThing schema + CRUD |
| dotdo | `db/graph/relationships.ts` | GraphRelationship schema + CRUD |
| dotdo | `compat/` | 70+ provider implementations |

---

## Conclusion

The type mapping between primitives.org.ai and dotdo is largely straightforward:

1. **Direct mappings**: Most tool metadata fields map 1:1
2. **Handler storage**: Already solved via handlerRegistry pattern
3. **Schema handling**: Both systems support Zod -> JSON Schema conversion
4. **MCP compatibility**: Types are nearly identical, direct conversion possible
5. **Provider integration**: Recommend using dotdo's compat/ layer wrapped as Tools

**Key Gap:** dotdo's `ToolCategory` needs extension to match primitives.org.ai's richer category set.

**Recommended Approach:** Bridge pattern where primitives.org.ai tools can be imported into dotdo's graph as Tool Things, with handlers registered at runtime.
