[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorEngine

# Interface: VectorEngine

Defined in: [db/core/vector.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L57)

## Methods

### count()

> **count**(): `Promise`\<`number`\>

Defined in: [db/core/vector.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L64)

#### Returns

`Promise`\<`number`\>

***

### delete()

> **delete**(`id`): `Promise`\<`boolean`\>

Defined in: [db/core/vector.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L63)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### insert()

> **insert**(`id`, `vector`, `metadata`): `Promise`\<`void`\>

Defined in: [db/core/vector.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L61)

#### Parameters

##### id

`string`

##### vector

`number`[]

##### metadata

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`void`\>

***

### search()

> **search**(`vector`, `options`): `Promise`\<[`VectorHit`](VectorHit.md)[]\>

Defined in: [db/core/vector.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L62)

#### Parameters

##### vector

`number`[]

##### options

[`SearchOptions`](SearchOptions.md)

#### Returns

`Promise`\<[`VectorHit`](VectorHit.md)[]\>

## Properties

### dimensions

> **dimensions**: `number`

Defined in: [db/core/vector.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L59)

***

### metric

> **metric**: `"cosine"` \| `"euclidean"` \| `"dot"`

Defined in: [db/core/vector.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L60)

***

### name

> **name**: [`VectorEngineType`](../type-aliases/VectorEngineType.md)

Defined in: [db/core/vector.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/vector.ts#L58)
