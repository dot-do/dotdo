[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ThingDO

# Interface: ThingDO

Defined in: [types/Thing.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L99)

## Extends

- [`Thing`](Thing.md)

## Methods

### collection()

> **collection**\<`T`\>(`noun`): [`Things`](Things.md)\<`T`\>

Defined in: [types/Thing.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L104)

#### Type Parameters

##### T

`T` *extends* [`Thing`](Thing.md) = [`Thing`](Thing.md)

#### Parameters

##### noun

`string`

#### Returns

[`Things`](Things.md)\<`T`\>

***

### delete()

> **delete**(): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Thing.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L83)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

#### Inherited from

[`Thing`](Thing.md).[`delete`](Thing.md#delete)

***

### promote()

> **promote**(): [`RpcPromise`](RpcPromise.md)\<`ThingDO`\>

Defined in: [types/Thing.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L86)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`ThingDO`\>

#### Inherited from

[`Thing`](Thing.md).[`promote`](Thing.md#promote)

***

### relate()

> **relate**(`verb`, `to`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Thing.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L89)

#### Parameters

##### verb

`string`

##### to

`string` | [`Thing`](Thing.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

#### Inherited from

[`Thing`](Thing.md).[`relate`](Thing.md#relate)

***

### unrelate()

> **unrelate**(`verb`, `to`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/Thing.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L92)

#### Parameters

##### verb

`string`

##### to

`string` | [`Thing`](Thing.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

#### Inherited from

[`Thing`](Thing.md).[`unrelate`](Thing.md#unrelate)

***

### update()

> **update**(`data`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

Defined in: [types/Thing.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L80)

#### Parameters

##### data

`Partial`\<[`ThingData`](ThingData.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

#### Inherited from

[`Thing`](Thing.md).[`update`](Thing.md#update)

## Properties

### $children?

> `optional` **$children**: `ThingDO`[]

Defined in: [types/Thing.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L120)

***

### $git?

> `optional` **$git**: `object`

Defined in: [types/Thing.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L107)

#### branch

> **branch**: `string`

#### commit

> **commit**: `string`

#### lastSyncAt

> **lastSyncAt**: `Date`

#### path

> **path**: `string`

#### repo

> **repo**: `string`

#### syncMode

> **syncMode**: `"pull"` \| `"push"` \| `"mirror"`

***

### $id

> **$id**: `string`

Defined in: [types/Thing.ts:20](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L20)

#### Inherited from

[`Thing`](Thing.md).[`$id`](Thing.md#id)

***

### $parent?

> `optional` **$parent**: `ThingDO`

Defined in: [types/Thing.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L117)

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

[`Thing`](Thing.md).[`$source`](Thing.md#source)

***

### $type

> **$type**: `string`

Defined in: [types/Thing.ts:21](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L21)

#### Inherited from

[`Thing`](Thing.md).[`$type`](Thing.md#type)

***

### $version?

> `optional` **$version**: `number`

Defined in: [types/Thing.ts:30](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L30)

#### Inherited from

[`Thing`](Thing.md).[`$version`](Thing.md#version)

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/Thing.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L41)

#### Inherited from

[`Thing`](Thing.md).[`createdAt`](Thing.md#createdat)

***

### data?

> `optional` **data**: `Record`\<`string`, `unknown`\>

Defined in: [types/Thing.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L25)

#### Inherited from

[`Thing`](Thing.md).[`data`](Thing.md#data)

***

### deletedAt?

> `optional` **deletedAt**: `Date`

Defined in: [types/Thing.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L43)

#### Inherited from

[`Thing`](Thing.md).[`deletedAt`](Thing.md#deletedat)

***

### identity

> `readonly` **identity**: [`ThingIdentity`](ThingIdentity.md)

Defined in: [types/Thing.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L58)

#### Inherited from

[`Thing`](Thing.md).[`identity`](Thing.md#identity)

***

### isDO

> `readonly` **isDO**: `true`

Defined in: [types/Thing.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L101)

#### Overrides

[`Thing`](Thing.md).[`isDO`](Thing.md#isdo)

***

### meta?

> `optional` **meta**: `Record`\<`string`, `unknown`\>

Defined in: [types/Thing.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L26)

#### Inherited from

[`Thing`](Thing.md).[`meta`](Thing.md#meta)

***

### name?

> `optional` **name**: `string`

Defined in: [types/Thing.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L24)

#### Inherited from

[`Thing`](Thing.md).[`name`](Thing.md#name)

***

### references

> **references**: `Record`\<`string`, [`Thing`](Thing.md) \| [`Thing`](Thing.md)[]\>

Defined in: [types/Thing.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L73)

#### Inherited from

[`Thing`](Thing.md).[`references`](Thing.md#references)

***

### relationships

> **relationships**: `Record`\<`string`, [`Thing`](Thing.md) \| [`Thing`](Thing.md)[]\>

Defined in: [types/Thing.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L69)

#### Inherited from

[`Thing`](Thing.md).[`relationships`](Thing.md#relationships)

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [types/Thing.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L42)

#### Inherited from

[`Thing`](Thing.md).[`updatedAt`](Thing.md#updatedat)

***

### visibility?

> `optional` **visibility**: [`Visibility`](../type-aliases/Visibility.md)

Defined in: [types/Thing.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Thing.ts#L27)

#### Inherited from

[`Thing`](Thing.md).[`visibility`](Thing.md#visibility)
