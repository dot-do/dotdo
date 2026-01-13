[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createToolThingRegistry

# Function: createToolThingRegistry()

> **createToolThingRegistry**(`store?`): [`ToolThingRegistry`](../classes/ToolThingRegistry.md)

Defined in: [agents/tool-thing.ts:623](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L623)

Create a ToolThingRegistry instance.

## Parameters

### store?

`GraphStore`

Optional graph store for persistence

## Returns

[`ToolThingRegistry`](../classes/ToolThingRegistry.md)

A new ToolThingRegistry

## Example

```typescript
// In-memory only
const registry = createToolRegistry()

// With graph persistence
const registry = createToolRegistry(graphStore)

// Register tools
await registry.register(myTool)

// Get a tool
const tool = await registry.get('myTool')
```
