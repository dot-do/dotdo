[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createAPITokenCounter

# Function: createAPITokenCounter()

> **createAPITokenCounter**(`countFn`): [`TokenCounter`](../type-aliases/TokenCounter.md)

Defined in: [agents/memory.ts:705](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L705)

Create a provider-based token counter that calls the model's tokenizer

## Parameters

### countFn

(`text`) => `Promise`\<`number`\>

## Returns

[`TokenCounter`](../type-aliases/TokenCounter.md)

## Example

```ts
const counter = createAPITokenCounter(async (text) => {
  const response = await fetch('/api/tokenize', { body: text })
  return response.json().tokenCount
})
memory.setTokenCounter(counter)
```
