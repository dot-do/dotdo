[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Thing

# Interface: Thing

Defined in: [types/Thing.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L53)

## Extends

- [`ThingData`](ThingData.md)

## Extended by

- [`ThingDO`](ThingDO.md)

## Methods

### delete()

> **delete**(): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Thing.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L83)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### promote()

> **promote**(): [`RpcPromise`](RpcPromise.md)\<[`ThingDO`](ThingDO.md)\>

Defined in: [types/Thing.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L86)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ThingDO`](ThingDO.md)\>

***

### relate()

> **relate**(`verb`, `to`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Thing.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L89)

#### Parameters

##### verb

`string`

##### to

`string` | `Thing`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### unrelate()

> **unrelate**(`verb`, `to`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Thing.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L92)

#### Parameters

##### verb

`string`

##### to

`string` | `Thing`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### update()

> **update**(`data`): [`RpcPromise`](RpcPromise.md)\<`Thing`\>

Defined in: [types/Thing.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L80)

#### Parameters

##### data

`Partial`\<[`ThingData`](ThingData.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<`Thing`\>

## Properties

### $id

> **$id**: `string`

Defined in: [types/Thing.ts:20](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L20)

#### Inherited from

[`ThingData`](ThingData.md).[`$id`](ThingData.md#id)

***

### $source?

> `optional` **$source**: `object`

Defined in: [types/Thing.ts:33](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L33)

#### branch

> **branch**: `string`

#### commit

> **commit**: `string`

#### path

> **path**: `string`

#### repo

> **repo**: `string`

#### Inherited from

[`ThingData`](ThingData.md).[`$source`](ThingData.md#source)

***

### $type

> **$type**: `string`

Defined in: [types/Thing.ts:21](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L21)

#### Inherited from

[`ThingData`](ThingData.md).[`$type`](ThingData.md#type)

***

### $version?

> `optional` **$version**: `number`

Defined in: [types/Thing.ts:30](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L30)

#### Inherited from

[`ThingData`](ThingData.md).[`$version`](ThingData.md#version)

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/Thing.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L41)

#### Inherited from

[`ThingData`](ThingData.md).[`createdAt`](ThingData.md#createdat)

***

### data?

> `optional` **data**: `Record`\<`string`, `unknown`\>

Defined in: [types/Thing.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L25)

#### Inherited from

[`ThingData`](ThingData.md).[`data`](ThingData.md#data)

***

### deletedAt?

> `optional` **deletedAt**: `Date`

Defined in: [types/Thing.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L43)

#### Inherited from

[`ThingData`](ThingData.md).[`deletedAt`](ThingData.md#deletedat)

***

### identity

> `readonly` **identity**: [`ThingIdentity`](ThingIdentity.md)

Defined in: [types/Thing.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L58)

***

### isDO

> `readonly` **isDO**: `boolean`

Defined in: [types/Thing.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L61)

***

### meta?

> `optional` **meta**: `Record`\<`string`, `unknown`\>

Defined in: [types/Thing.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L26)

#### Inherited from

[`ThingData`](ThingData.md).[`meta`](ThingData.md#meta)

***

### name?

> `optional` **name**: `string`

Defined in: [types/Thing.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L24)

#### Inherited from

[`ThingData`](ThingData.md).[`name`](ThingData.md#name)

***

### references

> **references**: `Record`\<`string`, `Thing` \| `Thing`[]\>

Defined in: [types/Thing.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L73)

***

### relationships

> **relationships**: `Record`\<`string`, `Thing` \| `Thing`[]\>

Defined in: [types/Thing.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L69)

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [types/Thing.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L42)

#### Inherited from

[`ThingData`](ThingData.md).[`updatedAt`](ThingData.md#updatedat)

***

### visibility?

> `optional` **visibility**: [`Visibility`](../type-aliases/Visibility.md)

Defined in: [types/Thing.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L27)

#### Inherited from

[`ThingData`](ThingData.md).[`visibility`](ThingData.md#visibility)
