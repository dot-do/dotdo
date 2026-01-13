[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Things

# Interface: Things()\<T\>

Defined in: [types/Things.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L74)

## Extends

- [`ThingsData`](ThingsData.md)

## Extended by

- [`ThingsDO`](ThingsDO.md)

## Type Parameters

### T

`T` *extends* [`Thing`](Thing.md) = [`Thing`](Thing.md)

> **Things**(`strings`, ...`values`): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:136](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L136)

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

***

### count()

> **count**(`query?`): [`RpcPromise`](RpcPromise.md)\<`number`\>

Defined in: [types/Things.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L102)

#### Parameters

##### query?

[`Query`](Query.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`number`\>

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

***

### delete()

> **delete**(`id`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Things.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L93)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### filter()

> **filter**(`predicate`): `Things`\<`T`\>

Defined in: [types/Things.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L119)

#### Parameters

##### predicate

(`item`) => `boolean`

#### Returns

`Things`\<`T`\>

***

### find()

> **find**(`query`): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L100)

#### Parameters

##### query

[`Query`](Query.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`[]\>

***

### first()

> **first**(`query?`): [`RpcPromise`](RpcPromise.md)\<`T` \| `null`\>

Defined in: [types/Things.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L101)

#### Parameters

##### query?

[`Query`](Query.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T` \| `null`\>

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

***

### get()

> **get**(`id`): [`RpcPromise`](RpcPromise.md)\<`T`\>

Defined in: [types/Things.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L90)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`\>

***

### limit()

> **limit**(`n`): `Things`\<`T`\>

Defined in: [types/Things.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L122)

#### Parameters

##### n

`number`

#### Returns

`Things`\<`T`\>

***

### list()

> **list**(): [`RpcPromise`](RpcPromise.md)\<`T`[]\>

Defined in: [types/Things.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L99)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`T`[]\>

***

### map()

> **map**\<`U`\>(`mapper`): `Things`\<`U`\>

Defined in: [types/Things.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L120)

#### Type Parameters

##### U

`U` *extends* [`Thing`](Thing.md)

#### Parameters

##### mapper

(`item`) => `U`

#### Returns

`Things`\<`U`\>

***

### offset()

> **offset**(`n`): `Things`\<`T`\>

Defined in: [types/Things.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L123)

#### Parameters

##### n

`number`

#### Returns

`Things`\<`T`\>

***

### promote()

> **promote**(): [`RpcPromise`](RpcPromise.md)\<[`ThingsDO`](ThingsDO.md)\<`T`\>\>

Defined in: [types/Things.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L143)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ThingsDO`](ThingsDO.md)\<`T`\>\>

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

***

### sort()

> **sort**(`compareFn`): `Things`\<`T`\>

Defined in: [types/Things.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L121)

#### Parameters

##### compareFn

(`a`, `b`) => `number`

#### Returns

`Things`\<`T`\>

***

### stream()

> **stream**(): [`RpcPromise`](RpcPromise.md)\<`AsyncIterable`\<`T`, `any`, `any`\>\>

Defined in: [types/Things.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L113)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`AsyncIterable`\<`T`, `any`, `any`\>\>

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

## Properties

### $id

> `readonly` **$id**: `string`

Defined in: [types/Things.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L79)

#### Overrides

[`ThingsData`](ThingsData.md).[`$id`](ThingsData.md#id)

***

### $type

> `readonly` **$type**: `string`

Defined in: [types/Things.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L80)

#### Overrides

[`ThingsData`](ThingsData.md).[`$type`](ThingsData.md#type)

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/Things.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L26)

#### Inherited from

[`ThingsData`](ThingsData.md).[`createdAt`](ThingsData.md#createdat)

***

### description?

> `optional` **description**: `string`

Defined in: [types/Things.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L25)

#### Inherited from

[`ThingsData`](ThingsData.md).[`description`](ThingsData.md#description)

***

### isDO

> `readonly` **isDO**: `boolean`

Defined in: [types/Things.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L84)

***

### itemType

> `readonly` **itemType**: `string`

Defined in: [types/Things.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L81)

#### Overrides

[`ThingsData`](ThingsData.md).[`itemType`](ThingsData.md#itemtype)

***

### name?

> `optional` **name**: `string`

Defined in: [types/Things.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L24)

#### Inherited from

[`ThingsData`](ThingsData.md).[`name`](ThingsData.md#name)

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [types/Things.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L27)

#### Inherited from

[`ThingsData`](ThingsData.md).[`updatedAt`](ThingsData.md#updatedat)
