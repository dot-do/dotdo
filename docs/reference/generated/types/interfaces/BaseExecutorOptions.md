[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / BaseExecutorOptions

# Interface: BaseExecutorOptions

Defined in: [types/AIFunction.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L145)

Base options shared by all function types

## Extended by

- [`CodeOptions`](CodeOptions.md)
- [`GenerativeOptions`](GenerativeOptions.md)
- [`HumanOptions`](HumanOptions.md)

## Properties

### cache?

> `optional` **cache**: `boolean` \| [`CacheConfig`](CacheConfig.md)

Defined in: [types/AIFunction.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L151)

Whether to cache results

***

### retry?

> `optional` **retry**: [`RetryConfig`](RetryConfig.md)

Defined in: [types/AIFunction.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L149)

Retry configuration

***

### tags?

> `optional` **tags**: `Record`\<`string`, `string`\>

Defined in: [types/AIFunction.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L153)

Tags for metrics/logging

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/AIFunction.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L147)

Execution timeout in milliseconds
