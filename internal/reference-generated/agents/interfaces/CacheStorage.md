[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CacheStorage

# Interface: CacheStorage

Defined in: [agents/tool-cache.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L96)

Cache storage interface for custom backends

## Methods

### clear()

> **clear**(): `void`

Defined in: [agents/tool-cache.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L100)

#### Returns

`void`

***

### delete()

> **delete**(`key`): `boolean`

Defined in: [agents/tool-cache.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L99)

#### Parameters

##### key

`string`

#### Returns

`boolean`

***

### get()

> **get**(`key`): [`CacheEntry`](CacheEntry.md)\<`unknown`\> \| `undefined`

Defined in: [agents/tool-cache.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L97)

#### Parameters

##### key

`string`

#### Returns

[`CacheEntry`](CacheEntry.md)\<`unknown`\> \| `undefined`

***

### keys()

> **keys**(): `IterableIterator`\<`string`\>

Defined in: [agents/tool-cache.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L101)

#### Returns

`IterableIterator`\<`string`\>

***

### set()

> **set**(`key`, `entry`): `void`

Defined in: [agents/tool-cache.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L98)

#### Parameters

##### key

`string`

##### entry

[`CacheEntry`](CacheEntry.md)

#### Returns

`void`

***

### size()

> **size**(): `number`

Defined in: [agents/tool-cache.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L102)

#### Returns

`number`
