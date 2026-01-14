[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / NounsRegistry

# Interface: NounsRegistry

Defined in: [types/DO.ts:196](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L196)

## Methods

### create()

> **create**(`data`): [`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md)\>

Defined in: [types/DO.ts:199](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L199)

#### Parameters

##### data

[`NounData`](NounData.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md)\>

***

### delete()

> **delete**(`noun`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:201](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L201)

#### Parameters

##### noun

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### get()

> **get**(`noun`): [`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md) \| `null`\>

Defined in: [types/DO.ts:197](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L197)

#### Parameters

##### noun

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md) \| `null`\>

***

### list()

> **list**(): [`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md)[]\>

Defined in: [types/DO.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L198)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md)[]\>

***

### update()

> **update**(`noun`, `data`): [`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md)\>

Defined in: [types/DO.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L200)

#### Parameters

##### noun

`string`

##### data

`Partial`\<[`NounData`](NounData.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Noun`](Noun.md)\>
