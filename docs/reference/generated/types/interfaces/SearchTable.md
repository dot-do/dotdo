[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / SearchTable

# Interface: SearchTable

Defined in: [types/DO.ts:255](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L255)

## Methods

### index()

> **index**(`thing`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:256](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L256)

#### Parameters

##### thing

[`Thing`](Thing.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### remove()

> **remove**(`$id`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:258](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L258)

#### Parameters

##### $id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### search()

> **search**(`query`, `options?`): [`RpcPromise`](RpcPromise.md)\<[`SearchResult`](SearchResult.md)[]\>

Defined in: [types/DO.ts:257](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L257)

#### Parameters

##### query

`string`

##### options?

###### limit?

`number`

###### type?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`SearchResult`](SearchResult.md)[]\>
