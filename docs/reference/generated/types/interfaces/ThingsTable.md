[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ThingsTable

# Interface: ThingsTable

Defined in: [types/DO.ts:212](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L212)

## Methods

### create()

> **create**(`data`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

Defined in: [types/DO.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L215)

#### Parameters

##### data

`Partial`\<[`ThingData`](ThingData.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

***

### delete()

> **delete**(`$id`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:217](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L217)

#### Parameters

##### $id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### find()

> **find**(`query`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)[]\>

Defined in: [types/DO.ts:218](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L218)

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)[]\>

***

### get()

> **get**(`$id`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md) \| `null`\>

Defined in: [types/DO.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L213)

#### Parameters

##### $id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md) \| `null`\>

***

### list()

> **list**(`query?`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)[]\>

Defined in: [types/DO.ts:214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L214)

#### Parameters

##### query?

###### $type?

`string`

###### ns?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)[]\>

***

### update()

> **update**(`$id`, `data`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

Defined in: [types/DO.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L216)

#### Parameters

##### $id

`string`

##### data

`Partial`\<[`ThingData`](ThingData.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>
