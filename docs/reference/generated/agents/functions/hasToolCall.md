[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / hasToolCall

# Function: hasToolCall()

> **hasToolCall**(`toolName`): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L98)

Stop when a specific tool is called

Useful for agents that should stop when they call a "finish" or "submit" tool.

## Parameters

### toolName

`string`

Name of the tool that triggers stop

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Stop condition that triggers when the tool is called

## Example

```ts
const agent = provider.createAgent({
  stopWhen: hasToolCall('submit_answer'),
})
```
