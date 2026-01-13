[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / tool

# Function: tool()

> **tool**\<`TInput`, `TOutput`\>(`options`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>

Defined in: [agents/Tool.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L116)

Create a tool definition with type inference

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### options

[`ToolOptions`](../interfaces/ToolOptions.md)\<`TInput`, `TOutput`\>

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>

## Example

```ts
const weatherTool = tool({
  name: 'getWeather',
  description: 'Get the current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name or coordinates'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: async ({ location, unit }) => {
    // Fetch weather data...
    return { temperature: 22, condition: 'sunny' }
  },
})
```
