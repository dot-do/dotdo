[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AgenticOptions

# Interface: AgenticOptions

Defined in: [types/AIFunction.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L204)

Options for agentic function execution
AI with tools in a loop

## Extends

- [`GenerativeOptions`](GenerativeOptions.md)

## Properties

### cache?

> `optional` **cache**: `boolean` \| [`CacheConfig`](CacheConfig.md)

Defined in: [types/AIFunction.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L151)

Whether to cache results

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`cache`](GenerativeOptions.md#cache)

***

### frequencyPenalty?

> `optional` **frequencyPenalty**: `number`

Defined in: [types/AIFunction.ts:187](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L187)

Frequency penalty

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`frequencyPenalty`](GenerativeOptions.md#frequencypenalty)

***

### jsonMode?

> `optional` **jsonMode**: `boolean`

Defined in: [types/AIFunction.ts:193](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L193)

JSON mode - force JSON output

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`jsonMode`](GenerativeOptions.md#jsonmode)

***

### maxIterations?

> `optional` **maxIterations**: `number`

Defined in: [types/AIFunction.ts:210](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L210)

Maximum iterations of the agent loop

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [types/AIFunction.ts:179](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L179)

Maximum tokens to generate

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`maxTokens`](GenerativeOptions.md#maxtokens)

***

### maxToolCalls?

> `optional` **maxToolCalls**: `number`

Defined in: [types/AIFunction.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L208)

Maximum number of tool calls

***

### memory?

> `optional` **memory**: [`MemoryConfig`](MemoryConfig.md)

Defined in: [types/AIFunction.ts:218](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L218)

Memory/context management

***

### model?

> `optional` **model**: `string`

Defined in: [types/AIFunction.ts:175](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L175)

Model identifier

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`model`](GenerativeOptions.md#model)

***

### outputSchema?

> `optional` **outputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:195](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L195)

Output schema for structured output

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`outputSchema`](GenerativeOptions.md#outputschema)

***

### parallelToolCalls?

> `optional` **parallelToolCalls**: `boolean`

Defined in: [types/AIFunction.ts:212](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L212)

Whether to allow parallel tool calls

***

### planningMode?

> `optional` **planningMode**: `"none"` \| `"react"` \| `"tree-of-thought"`

Defined in: [types/AIFunction.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L216)

Planning strategy

***

### presencePenalty?

> `optional` **presencePenalty**: `number`

Defined in: [types/AIFunction.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L189)

Presence penalty

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`presencePenalty`](GenerativeOptions.md#presencepenalty)

***

### provider?

> `optional` **provider**: `AIProvider`

Defined in: [types/AIFunction.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L173)

AI provider to use

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`provider`](GenerativeOptions.md#provider)

***

### retry?

> `optional` **retry**: [`RetryConfig`](RetryConfig.md)

Defined in: [types/AIFunction.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L149)

Retry configuration

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`retry`](GenerativeOptions.md#retry)

***

### seed?

> `optional` **seed**: `number`

Defined in: [types/AIFunction.ts:197](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L197)

Seed for reproducible outputs (if supported)

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`seed`](GenerativeOptions.md#seed)

***

### stopSequences?

> `optional` **stopSequences**: `string`[]

Defined in: [types/AIFunction.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L183)

Stop sequences

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`stopSequences`](GenerativeOptions.md#stopsequences)

***

### stream?

> `optional` **stream**: `boolean`

Defined in: [types/AIFunction.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L191)

Whether to stream the response

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`stream`](GenerativeOptions.md#stream)

***

### systemPrompt?

> `optional` **systemPrompt**: `string`

Defined in: [types/AIFunction.ts:181](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L181)

System prompt

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`systemPrompt`](GenerativeOptions.md#systemprompt)

***

### tags?

> `optional` **tags**: `Record`\<`string`, `string`\>

Defined in: [types/AIFunction.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L153)

Tags for metrics/logging

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`tags`](GenerativeOptions.md#tags)

***

### temperature?

> `optional` **temperature**: `number`

Defined in: [types/AIFunction.ts:177](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L177)

Temperature for generation (0-2)

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`temperature`](GenerativeOptions.md#temperature)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/AIFunction.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L147)

Execution timeout in milliseconds

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`timeout`](GenerativeOptions.md#timeout)

***

### toolChoice?

> `optional` **toolChoice**: `"auto"` \| `"required"` \| `"none"` \| \{ `name`: `string`; `type`: `"tool"`; \}

Defined in: [types/AIFunction.ts:214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L214)

Tool choice strategy

***

### tools?

> `optional` **tools**: [`Tool`](Tool.md)\<`unknown`, `unknown`\>[]

Defined in: [types/AIFunction.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L206)

Available tools for the agent

***

### topP?

> `optional` **topP**: `number`

Defined in: [types/AIFunction.ts:185](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L185)

Top-p sampling

#### Inherited from

[`GenerativeOptions`](GenerativeOptions.md).[`topP`](GenerativeOptions.md#topp)
