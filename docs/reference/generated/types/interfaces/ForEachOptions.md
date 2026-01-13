[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ForEachOptions

# Interface: ForEachOptions

Defined in: [types/Things.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L46)

## Properties

### concurrency?

> `optional` **concurrency**: `number`

Defined in: [types/Things.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L47)

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [types/Things.ts:48](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L48)

***

### onError()?

> `optional` **onError**: (`error`, `item`) => `"skip"` \| `"retry"` \| `"abort"`

Defined in: [types/Things.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L51)

#### Parameters

##### error

`Error`

##### item

[`Thing`](Thing.md)

#### Returns

`"skip"` \| `"retry"` \| `"abort"`

***

### onProgress()?

> `optional` **onProgress**: (`progress`) => `void`

Defined in: [types/Things.ts:50](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L50)

#### Parameters

##### progress

[`ForEachProgress`](ForEachProgress.md)

#### Returns

`void`

***

### persist?

> `optional` **persist**: `boolean`

Defined in: [types/Things.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L52)

***

### resume?

> `optional` **resume**: `string`

Defined in: [types/Things.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L53)

***

### retryDelay?

> `optional` **retryDelay**: `number`

Defined in: [types/Things.ts:49](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L49)
