[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Collection

# Interface: Collection\<T\>

Defined in: [types/Collection.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L64)

Collection interface with CRUD and query operations

## Extends

- [`CollectionData`](../type-aliases/CollectionData.md)

## Type Parameters

### T

`T` *extends* `Thing` = `Thing`

## Methods

### buildItemId()

> **buildItemId**(`id`): `string`

Defined in: [types/Collection.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L66)

#### Parameters

##### id

`string`

#### Returns

`string`

***

### count()

> **count**(`query?`): `Promise`\<`number`\>

Defined in: [types/Collection.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L77)

#### Parameters

##### query?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`number`\>

***

### create()

> **create**(`id`, `data`): `Promise`\<`T`\>

Defined in: [types/Collection.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L70)

#### Parameters

##### id

`string`

##### data

`Partial`\<`Omit`\<`T`, `"$id"` \| `"$type"`\>\>

#### Returns

`Promise`\<`T`\>

***

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [types/Collection.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L72)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### find()

> **find**(`query`): `Promise`\<`T`[]\>

Defined in: [types/Collection.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L76)

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`T`[]\>

***

### get()

> **get**(`id`): `Promise`\<`T` \| `null`\>

Defined in: [types/Collection.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L69)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`T` \| `null`\>

***

### list()

> **list**(`options?`): `Promise`\<\{ `cursor?`: `string`; `items`: `T`[]; \}\>

Defined in: [types/Collection.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L75)

#### Parameters

##### options?

###### cursor?

`string`

###### limit?

`number`

#### Returns

`Promise`\<\{ `cursor?`: `string`; `items`: `T`[]; \}\>

***

### update()

> **update**(`id`, `data`): `Promise`\<`T`\>

Defined in: [types/Collection.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L71)

#### Parameters

##### id

`string`

##### data

`Partial`\<`T`\>

#### Returns

`Promise`\<`T`\>

## Properties

### $id

> `readonly` **$id**: `string`

Defined in: [types/Collection.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L24)

#### Inherited from

`CollectionData.$id`

***

### $type

> `readonly` **$type**: `"https://schema.org.ai/Collection"`

Defined in: [types/Collection.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L25)

#### Inherited from

`CollectionData.$type`

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/Collection.ts:30](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L30)

#### Inherited from

`CollectionData.createdAt`

***

### description?

> `optional` **description**: `string`

Defined in: [types/Collection.ts:29](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L29)

#### Inherited from

`CollectionData.description`

***

### itemType

> `readonly` **itemType**: `string`

Defined in: [types/Collection.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L27)

#### Inherited from

`CollectionData.itemType`

***

### name?

> `optional` **name**: `string`

Defined in: [types/Collection.ts:28](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L28)

#### Inherited from

`CollectionData.name`

***

### ns

> `readonly` **ns**: `string`

Defined in: [types/Collection.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L26)

#### Inherited from

`CollectionData.ns`

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [types/Collection.ts:31](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L31)

#### Inherited from

`CollectionData.updatedAt`
