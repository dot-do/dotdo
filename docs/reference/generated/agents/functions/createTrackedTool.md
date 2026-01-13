[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createTrackedTool

# Function: createTrackedTool()

> **createTrackedTool**\<`TInput`\>(`name`, `returnValue`): \[[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `unknown`\>, `object`[]\]

Defined in: [agents/testing.ts:572](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L572)

Create a mock tool that tracks calls

## Type Parameters

### TInput

`TInput` = `Record`\<`string`, `unknown`\>

## Parameters

### name

`string`

### returnValue

`unknown` = `...`

## Returns

\[[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `unknown`\>, `object`[]\]

## Example

```ts
const [tool, calls] = createTrackedTool('search')

// ... run agent with tool ...

expect(calls).toHaveLength(2)
expect(calls[0].input).toEqual({ query: 'first search' })
```
