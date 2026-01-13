[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createTiktokenCounter

# Function: createTiktokenCounter()

> **createTiktokenCounter**(`model`, `getEncoding`): [`TokenCounter`](../type-aliases/TokenCounter.md)

Defined in: [agents/memory.ts:664](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L664)

Create a tiktoken-based token counter (requires tiktoken package)

## Parameters

### model

`string`

### getEncoding

(`model`) => `object`

## Returns

[`TokenCounter`](../type-aliases/TokenCounter.md)

## Example

```ts
import { encoding_for_model } from 'tiktoken'

const counter = createTiktokenCounter('gpt-4o')
memory.setTokenCounter(counter)
```
