[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / customStop

# Function: customStop()

> **customStop**(`check`): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:138](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L138)

Stop based on custom logic

Provides full access to step state for complex termination conditions.

## Parameters

### check

(`state`) => `boolean`

Function that returns true when agent should stop

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Stop condition with custom evaluation logic

## Example

```ts
const agent = provider.createAgent({
  stopWhen: customStop((state) => {
    // Stop if we've used too many tokens
    return state.totalTokens > 10000
  }),
})
```
