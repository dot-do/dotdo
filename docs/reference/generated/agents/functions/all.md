[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / all

# Function: all()

> **all**(...`conditions`): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:223](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L223)

Combine multiple conditions with AND logic

All conditions must be true for the agent to stop.

## Parameters

### conditions

...[`StopCondition`](../type-aliases/StopCondition.md)[]

Conditions that must ALL be satisfied

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Composite stop condition

## Example

```ts
const agent = provider.createAgent({
  // Stop only when we have text AND we've done at least 2 steps
  stopWhen: all(hasText(), stepCountIs(2)),
})
```
