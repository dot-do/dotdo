[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / hasText

# Function: hasText()

> **hasText**(): [`StopCondition`](../type-aliases/StopCondition.md)

Defined in: [agents/stopConditions.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/stopConditions.ts#L116)

Stop when the agent produces text output

Useful for chat agents that should stop after generating a response.

## Returns

[`StopCondition`](../type-aliases/StopCondition.md)

Stop condition that triggers when non-empty text is produced

## Example

```ts
const agent = provider.createAgent({
  stopWhen: hasText(),
})
```
