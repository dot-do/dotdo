[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / listToolsFromGraph

# Function: listToolsFromGraph()

> **listToolsFromGraph**(`store`, `options?`): `Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\>[]\>

Defined in: [agents/tool-thing.ts:389](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L389)

List all tools from the graph store.

Retrieves all Tool Things from the graph and converts them to
ToolDefinitions. Tools without registered handlers are skipped.

## Parameters

### store

`GraphStore`

The graph store to list from

### options?

Optional pagination and filtering options

#### limit?

`number`

#### offset?

`number`

## Returns

`Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\>[]\>

Array of ToolDefinitions

## Example

```typescript
const tools = await listToolsFromGraph(graphStore)
console.log(`Found ${tools.length} tools`)
```
