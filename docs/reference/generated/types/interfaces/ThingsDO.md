[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ThingsDO

# Interface: ThingsDO()\<T\>

Defined in: [types/Things.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L150)

## Extends

- [`Things`](Things.md)\<`T`\>

## Type Parameters

### T

`T` *extends* [`Thing`](Thing.md) = [`Thing`](Thing.md)

> **ThingsDO**(`strings`, ...`values`): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L150)

## Parameters

### strings

`TemplateStringsArray`

### values

...`unknown`[]

## Returns

[`RpcPromise`](RpcPromise.md)\<`T`[]\>

## Methods

### \[asyncIterator\]()

> **\[asyncIterator\]**(): `AsyncIterator`\<`T`\>

Defined in: [types/Things.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L110)

#### Returns

`AsyncIterator`\<`T`\>

#### Inherited from

[`Things`](Things.md).[`[asyncIterator]`](Things.md#asynciterator)

***

### count()

> **count**(`query?`): [`RpcPromise`](RpcPromise.md)\<`number`\>

Defined in: [types/Things.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L102)

#### Parameters

##### query?

[`Query`](Query.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`number`\>

#### Inherited from

[`Things`](Things.md).[`count`](Things.md#count)

***

### create()

> **create**(`data`, `options?`): [`RpcPromise`](RpcPromise.md)\<`T`\>

Defined in: [types/Things.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L91)

#### Parameters

##### data

`Partial`\<`Omit`\<`T`, `"$id"` \| `"$type"` \| `"ns"`\>\>

##### options?

[`CreateOptions`](CreateOptions.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`create`](Things.md#create)

***

### delete()

> **delete**(`id`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Things.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L93)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

#### Inherited from

[`Things`](Things.md).[`delete`](Things.md#delete)

***

### filter()

> **filter**(`predicate`): [`Things`](Things.md)\<`T`\>

Defined in: [types/Things.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L119)

#### Parameters

##### predicate

(`item`) => `boolean`

#### Returns

[`Things`](Things.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`filter`](Things.md#filter)

***

### find()

> **find**(`query`): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L100)

#### Parameters

##### query

[`Query`](Query.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`[]\>

#### Inherited from

[`Things`](Things.md).[`find`](Things.md#find)

***

### first()

> **first**(`query?`): [`RpcPromise`](RpcPromise.md)\<`T` \| `null`\>

Defined in: [types/Things.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L101)

#### Parameters

##### query?

[`Query`](Query.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T` \| `null`\>

#### Inherited from

[`Things`](Things.md).[`first`](Things.md#first)

***

### forEach()

> **forEach**(`fn`, `options?`): [`RpcPromise`](RpcPromise.md)\<[`ForEachProgress`](ForEachProgress.md)\>

Defined in: [types/Things.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L129)

#### Parameters

##### fn

(`item`) => `Promise`\<`void`\>

##### options?

[`ForEachOptions`](ForEachOptions.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ForEachProgress`](ForEachProgress.md)\>

#### Inherited from

[`Things`](Things.md).[`forEach`](Things.md#foreach)

***

### get()

> **get**(`id`): [`RpcPromise`](RpcPromise.md)\<`T`\>

Defined in: [types/Things.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L90)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`get`](Things.md#get)

***

### limit()

> **limit**(`n`): [`Things`](Things.md)\<`T`\>

Defined in: [types/Things.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L122)

#### Parameters

##### n

`number`

#### Returns

[`Things`](Things.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`limit`](Things.md#limit)

***

### list()

> **list**(): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L99)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`[]\>

#### Inherited from

[`Things`](Things.md).[`list`](Things.md#list)

***

### map()

> **map**\<`U`\>(`mapper`): [`Things`](Things.md)\<`U`\>

Defined in: [types/Things.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L120)

#### Type Parameters

##### U

`U` *extends* [`Thing`](Thing.md)

#### Parameters

##### mapper

(`item`) => `U`

#### Returns

[`Things`](Things.md)\<`U`\>

#### Inherited from

[`Things`](Things.md).[`map`](Things.md#map)

***

### offset()

> **offset**(`n`): [`Things`](Things.md)\<`T`\>

Defined in: [types/Things.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L123)

#### Parameters

##### n

`number`

#### Returns

[`Things`](Things.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`offset`](Things.md#offset)

***

### promote()

> **promote**(): [`RpcPromise`](RpcPromise.md)\<`ThingsDO`\<`T`\>\>

Defined in: [types/Things.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L143)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`ThingsDO`\<`T`\>\>

#### Inherited from

[`Things`](Things.md).[`promote`](Things.md#promote)

***

### promoteThing()

> **promoteThing**(`id`): [`RpcPromise`](RpcPromise.md)\<[`ThingDO`](ThingDO.md)\>

Defined in: [types/Things.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L160)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ThingDO`](ThingDO.md)\>

***

### resolve()

> **resolve**(`url`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

Defined in: [types/Things.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L157)

#### Parameters

##### url

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

***

### search()

> **search**(`text`, `limit?`): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L103)

#### Parameters

##### text

`string`

##### limit?

`number`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`[]\>

#### Inherited from

[`Things`](Things.md).[`search`](Things.md#search)

***

### sort()

> **sort**(`compareFn`): [`Things`](Things.md)\<`T`\>

Defined in: [types/Things.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L121)

#### Parameters

##### compareFn

(`a`, `b`) => `number`

#### Returns

[`Things`](Things.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`sort`](Things.md#sort)

***

### stream()

> **stream**(): [`RpcPromise`](RpcPromise.md)\<`AsyncIterable`\<`T`, `any`, `any`\>\>

Defined in: [types/Things.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L113)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`AsyncIterable`\<`T`, `any`, `any`\>\>

#### Inherited from

[`Things`](Things.md).[`stream`](Things.md#stream)

***

### update()

> **update**(`id`, `data`): [`RpcPromise`](RpcPromise.md)\<`T`\>

Defined in: [types/Things.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L92)

#### Parameters

##### id

`string`

##### data

`Partial`\<`T`\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`\>

#### Inherited from

[`Things`](Things.md).[`update`](Things.md#update)

## Properties

### $id

> `readonly` **$id**: `string`

Defined in: [types/Things.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L79)

#### Inherited from

[`Things`](Things.md).[`$id`](Things.md#id)

***

### $type

> `readonly` **$type**: `string`

Defined in: [types/Things.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L80)

#### Inherited from

[`Things`](Things.md).[`$type`](Things.md#type)

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/Things.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L26)

#### Inherited from

[`Things`](Things.md).[`createdAt`](Things.md#createdat)

***

### description?

> `optional` **description**: `string`

Defined in: [types/Things.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L25)

#### Inherited from

[`Things`](Things.md).[`description`](Things.md#description)

***

### isDO

> `readonly` **isDO**: `true`

Defined in: [types/Things.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L151)

#### Overrides

[`Things`](Things.md).[`isDO`](Things.md#isdo)

***

### itemType

> `readonly` **itemType**: `string`

Defined in: [types/Things.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L81)

#### Inherited from

[`Things`](Things.md).[`itemType`](Things.md#itemtype)

***

### name?

> `optional` **name**: `string`

Defined in: [types/Things.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L24)

#### Inherited from

[`Things`](Things.md).[`name`](Things.md#name)

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [types/Things.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L27)

#### Inherited from

[`Things`](Things.md).[`updatedAt`](Things.md#updatedat)
