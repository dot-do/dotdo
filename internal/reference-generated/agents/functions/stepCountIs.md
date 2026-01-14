[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / stepCountIs

# Function: stepCountIs()

> **stepCountIs**(`count`): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L79)

Stop after a specific number of steps

## Parameters

### count

`number`

Maximum number of steps before stopping

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Stop condition that triggers when stepNumber >= count

## Example

```ts
const agent = provider.createAgent({
  stopWhen: stepCountIs(5), // Stop after 5 steps max
})
```
