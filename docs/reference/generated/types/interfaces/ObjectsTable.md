[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ObjectsTable

# Interface: ObjectsTable

Defined in: [types/DO.ts:232](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L232)

## Methods

### create()

> **create**(`data`): [`RpcPromise`](RpcPromise.md)\<[`ObjectRef`](ObjectRef.md)\>

Defined in: [types/DO.ts:235](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L235)

#### Parameters

##### data

###### doClass

`string`

###### doId

`string`

###### ns

`string`

###### relationType?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ObjectRef`](ObjectRef.md)\>

***

### delete()

> **delete**(`ns`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:236](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L236)

#### Parameters

##### ns

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### get()

> **get**(`ns`): [`RpcPromise`](RpcPromise.md)\<[`ObjectRef`](ObjectRef.md) \| `null`\>

Defined in: [types/DO.ts:233](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L233)

#### Parameters

##### ns

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ObjectRef`](ObjectRef.md) \| `null`\>

***

### list()

> **list**(`query?`): [`RpcPromise`](RpcPromise.md)\<[`ObjectRef`](ObjectRef.md)[]\>

Defined in: [types/DO.ts:234](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L234)

#### Parameters

##### query?

###### relationType?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`ObjectRef`](ObjectRef.md)[]\>
