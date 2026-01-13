[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ThingsCollection

# Type Alias: ThingsCollection\<T\>

> **ThingsCollection**\<`T`\> = [`Things`](../interfaces/Things.md)\<`T`\> & `object`

Defined in: [types/Things.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Things.ts#L168)

## Type Declaration

### then()

> **then**\<`TResult`\>(`onfulfilled?`): [`RpcPromise`](../interfaces/RpcPromise.md)\<`TResult`\>

#### Type Parameters

##### TResult

`TResult`

#### Parameters

##### onfulfilled?

(`value`) => `TResult` \| `PromiseLike`\<`TResult`\>

#### Returns

[`RpcPromise`](../interfaces/RpcPromise.md)\<`TResult`\>

## Type Parameters

### T

`T` *extends* [`Thing`](../interfaces/Thing.md) = [`Thing`](../interfaces/Thing.md)
