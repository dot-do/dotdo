[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / InMemoryCacheStorage

# Class: InMemoryCacheStorage

Defined in: [agents/tool-cache.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L206)

Default in-memory cache storage using Map with LRU eviction

## Implements

- [`CacheStorage`](../interfaces/CacheStorage.md)

## Constructors

### Constructor

> **new InMemoryCacheStorage**(`maxSize`): `InMemoryCacheStorage`

Defined in: [agents/tool-cache.ts:210](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L210)

#### Parameters

##### maxSize

`number` = `500`

#### Returns

`InMemoryCacheStorage`

## Methods

### clear()

> **clear**(): `void`

Defined in: [agents/tool-cache.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L245)

#### Returns

`void`

#### Implementation of

[`CacheStorage`](../interfaces/CacheStorage.md).[`clear`](../interfaces/CacheStorage.md#clear)

***

### delete()

> **delete**(`key`): `boolean`

Defined in: [agents/tool-cache.ts:241](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L241)

#### Parameters

##### key

`string`

#### Returns

`boolean`

#### Implementation of

[`CacheStorage`](../interfaces/CacheStorage.md).[`delete`](../interfaces/CacheStorage.md#delete)

***

### get()

> **get**(`key`): [`CacheEntry`](../interfaces/CacheEntry.md)\<`unknown`\> \| `undefined`

Defined in: [agents/tool-cache.ts:214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L214)

#### Parameters

##### key

`string`

#### Returns

[`CacheEntry`](../interfaces/CacheEntry.md)\<`unknown`\> \| `undefined`

#### Implementation of

[`CacheStorage`](../interfaces/CacheStorage.md).[`get`](../interfaces/CacheStorage.md#get)

***

### keys()

> **keys**(): `IterableIterator`\<`string`\>

Defined in: [agents/tool-cache.ts:249](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L249)

#### Returns

`IterableIterator`\<`string`\>

#### Implementation of

[`CacheStorage`](../interfaces/CacheStorage.md).[`keys`](../interfaces/CacheStorage.md#keys)

***

### set()

> **set**(`key`, `entry`): `void`

Defined in: [agents/tool-cache.ts:224](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L224)

#### Parameters

##### key

`string`

##### entry

[`CacheEntry`](../interfaces/CacheEntry.md)

#### Returns

`void`

#### Implementation of

[`CacheStorage`](../interfaces/CacheStorage.md).[`set`](../interfaces/CacheStorage.md#set)

***

### size()

> **size**(): `number`

Defined in: [agents/tool-cache.ts:253](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L253)

#### Returns

`number`

#### Implementation of

[`CacheStorage`](../interfaces/CacheStorage.md).[`size`](../interfaces/CacheStorage.md#size)
