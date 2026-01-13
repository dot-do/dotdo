[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GenerativeOptions

# Interface: GenerativeOptions

Defined in: [types/AIFunction.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L171)

Options for generative function execution
Single AI completion

## Extends

- [`BaseExecutorOptions`](BaseExecutorOptions.md)

## Extended by

- [`AgenticOptions`](AgenticOptions.md)

## Properties

### cache?

> `optional` **cache**: `boolean` \| [`CacheConfig`](CacheConfig.md)

Defined in: [types/AIFunction.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L151)

Whether to cache results

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`cache`](BaseExecutorOptions.md#cache)

***

### frequencyPenalty?

> `optional` **frequencyPenalty**: `number`

Defined in: [types/AIFunction.ts:187](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L187)

Frequency penalty

***

### jsonMode?

> `optional` **jsonMode**: `boolean`

Defined in: [types/AIFunction.ts:193](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L193)

JSON mode - force JSON output

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [types/AIFunction.ts:179](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L179)

Maximum tokens to generate

***

### model?

> `optional` **model**: `string`

Defined in: [types/AIFunction.ts:175](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L175)

Model identifier

***

### outputSchema?

> `optional` **outputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:195](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L195)

Output schema for structured output

***

### presencePenalty?

> `optional` **presencePenalty**: `number`

Defined in: [types/AIFunction.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L189)

Presence penalty

***

### provider?

> `optional` **provider**: `AIProvider`

Defined in: [types/AIFunction.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L173)

AI provider to use

***

### retry?

> `optional` **retry**: [`RetryConfig`](RetryConfig.md)

Defined in: [types/AIFunction.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L149)

Retry configuration

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`retry`](BaseExecutorOptions.md#retry)

***

### seed?

> `optional` **seed**: `number`

Defined in: [types/AIFunction.ts:197](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L197)

Seed for reproducible outputs (if supported)

***

### stopSequences?

> `optional` **stopSequences**: `string`[]

Defined in: [types/AIFunction.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L183)

Stop sequences

***

### stream?

> `optional` **stream**: `boolean`

Defined in: [types/AIFunction.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L191)

Whether to stream the response

***

### systemPrompt?

> `optional` **systemPrompt**: `string`

Defined in: [types/AIFunction.ts:181](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L181)

System prompt

***

### tags?

> `optional` **tags**: `Record`\<`string`, `string`\>

Defined in: [types/AIFunction.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L153)

Tags for metrics/logging

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`tags`](BaseExecutorOptions.md#tags)

***

### temperature?

> `optional` **temperature**: `number`

Defined in: [types/AIFunction.ts:177](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L177)

Temperature for generation (0-2)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/AIFunction.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L147)

Execution timeout in milliseconds

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`timeout`](BaseExecutorOptions.md#timeout)

***

### topP?

> `optional` **topP**: `number`

Defined in: [types/AIFunction.ts:185](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L185)

Top-p sampling
