[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / any

# Function: any()

> **any**(...`conditions`): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:246](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L246)

Combine multiple conditions with OR logic

Stop if ANY condition is satisfied.

## Parameters

### conditions

...[`StopCondition`](../type-aliases/StopCondition.md)[]

Conditions where ANY can trigger stop

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Composite stop condition

## Example

```ts
const agent = provider.createAgent({
  // Stop on finish tool OR after 10 steps
  stopWhen: any(hasToolCall('finish'), stepCountIs(10)),
})
```
