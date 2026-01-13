[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CodeOptions

# Interface: CodeOptions

Defined in: [types/AIFunction.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L160)

Options for code function execution
Deterministic, synchronous execution

## Extends

- [`BaseExecutorOptions`](BaseExecutorOptions.md)

## Properties

### cache?

> `optional` **cache**: `boolean` \| [`CacheConfig`](CacheConfig.md)

Defined in: [types/AIFunction.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L151)

Whether to cache results

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`cache`](BaseExecutorOptions.md#cache)

***

### memoryLimit?

> `optional` **memoryLimit**: `number`

Defined in: [types/AIFunction.ts:164](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L164)

Memory limit in MB

***

### retry?

> `optional` **retry**: [`RetryConfig`](RetryConfig.md)

Defined in: [types/AIFunction.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L149)

Retry configuration

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`retry`](BaseExecutorOptions.md#retry)

***

### sandbox?

> `optional` **sandbox**: `boolean`

Defined in: [types/AIFunction.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L162)

Whether to run in a sandboxed environment

***

### tags?

> `optional` **tags**: `Record`\<`string`, `string`\>

Defined in: [types/AIFunction.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L153)

Tags for metrics/logging

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`tags`](BaseExecutorOptions.md#tags)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/AIFunction.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L147)

Execution timeout in milliseconds

#### Inherited from

[`BaseExecutorOptions`](BaseExecutorOptions.md).[`timeout`](BaseExecutorOptions.md#timeout)
