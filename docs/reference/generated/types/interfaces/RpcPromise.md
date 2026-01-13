[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RpcPromise

# Interface: RpcPromise\<T\>

Defined in: [types/fn.ts:50](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L50)

Promise-like type that supports RPC pipelining operations.

## Extends

- `Promise`\<`T`\>

## Type Parameters

### T

`T`

## Methods

### map()

> **map**\<`U`\>(`fn`): `RpcPromise`\<`U`\>

Defined in: [types/fn.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L52)

#### Type Parameters

##### U

`U`

#### Parameters

##### fn

(`data`) => `U`

#### Returns

`RpcPromise`\<`U`\>

***

### pipe()

> **pipe**\<`U`\>(`fn`): `RpcPromise`\<`U`\>

Defined in: [types/fn.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L51)

#### Type Parameters

##### U

`U`

#### Parameters

##### fn

(`data`) => `U`

#### Returns

`RpcPromise`\<`U`\>
