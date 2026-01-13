[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RelationshipsTable

# Interface: RelationshipsTable

Defined in: [types/DO.ts:221](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L221)

## Methods

### create()

> **create**(`data`): [`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)\>

Defined in: [types/DO.ts:224](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L224)

#### Parameters

##### data

###### data?

`unknown`

###### from

`string`

###### to

`string`

###### verb

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)\>

***

### delete()

> **delete**(`id`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:225](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L225)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### get()

> **get**(`id`): [`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md) \| `null`\>

Defined in: [types/DO.ts:222](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L222)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md) \| `null`\>

***

### inbound()

> **inbound**(`to`): [`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)[]\>

Defined in: [types/DO.ts:229](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L229)

#### Parameters

##### to

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)[]\>

***

### list()

> **list**(`query?`): [`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)[]\>

Defined in: [types/DO.ts:223](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L223)

#### Parameters

##### query?

###### from?

`string`

###### to?

`string`

###### verb?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)[]\>

***

### outbound()

> **outbound**(`from`): [`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)[]\>

Defined in: [types/DO.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L227)

#### Parameters

##### from

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Relationship`](Relationship.md)[]\>
