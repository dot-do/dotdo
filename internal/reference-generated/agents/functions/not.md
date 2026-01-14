[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / not

# Function: not()

> **not**(`condition`): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:265](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L265)

Negate a stop condition

## Parameters

### condition

[`StopCondition`](../type-aliases/StopCondition.md)

Condition to negate

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Stop condition that triggers when original condition is NOT met

## Example

```ts
// Stop when there's NO text (useful for tool-only agents)
stopWhen: not(hasText())
```
