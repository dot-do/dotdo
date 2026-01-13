[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / toolToThing

# Function: toolToThing()

> **toolToThing**\<`TInput`, `TOutput`\>(`tool`): `object`

Defined in: [agents/tool-thing.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L162)

Convert a ToolDefinition to a GraphThing.

This registers the execute handler and creates a Thing data structure
that can be stored in the graph. The actual storage is done by the caller.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### tool

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>

The ToolDefinition to convert

## Returns

`object`

Object containing the Thing input and handler ID

### handlerId

> **handlerId**: `string`

### thingInput

> **thingInput**: `object`

#### thingInput.data

> **data**: [`ToolThingData`](../interfaces/ToolThingData.md)

#### thingInput.id

> **id**: `string`

#### thingInput.typeId

> **typeId**: `number`

#### thingInput.typeName

> **typeName**: `string`

## Example

```typescript
import { tool } from './Tool'
import { toolToThing } from './tool-thing'

const weatherTool = tool({
  name: 'getWeather',
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => ({ temp: 22 }),
})

const { thingInput, handlerId } = toolToThing(weatherTool)
// Store thingInput in graph...
```
