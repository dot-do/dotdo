[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createMockTool

# Function: createMockTool()

> **createMockTool**\<`TInput`, `TOutput`\>(`options`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>

Defined in: [agents/testing.ts:544](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L544)

Create a mock tool for testing

## Type Parameters

### TInput

`TInput` = `Record`\<`string`, `unknown`\>

### TOutput

`TOutput` = `unknown`

## Parameters

### options

#### description?

`string`

#### execute?

(`input`) => `Promise`\<`TOutput`\>

#### executeSync?

(`input`) => `TOutput`

#### inputSchema?

[`Schema`](../type-aliases/Schema.md)\<`unknown`\>

#### name

`string`

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>

## Example

```ts
const searchTool = createMockTool({
  name: 'search',
  description: 'Search the web',
  execute: async ({ query }) => ({ results: [`Result for: ${query}`] }),
})
```
