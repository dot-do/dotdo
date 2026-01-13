[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / thingToTool

# Function: thingToTool()

> **thingToTool**(`thing`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\> \| `null`

Defined in: [agents/tool-thing.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L227)

Convert a GraphThing back to a ToolDefinition.

This retrieves the handler from the registry and reconstructs
the ToolDefinition. Returns null if the handler is not found.

## Parameters

### thing

The GraphThing to convert (must be a Tool Thing)

#### createdAt

`number`

#### data

`Record`\<`string`, `unknown`\> \| `null`

#### deletedAt

`number` \| `null`

#### id

`string`

#### typeId

`number`

#### typeName

`string`

#### updatedAt

`number`

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\> \| `null`

The ToolDefinition or null if handler not found

## Example

```typescript
const thing = await graphStore.getThing('tool:getWeather')
const tool = thingToTool(thing)
if (tool) {
  const result = await tool.execute({ location: 'SF' }, ctx)
}
```
