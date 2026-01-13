[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / VerbsRegistry

# Interface: VerbsRegistry

Defined in: [types/DO.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L204)

## Methods

### create()

> **create**(`data`): [`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md)\>

Defined in: [types/DO.ts:207](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L207)

#### Parameters

##### data

[`VerbData`](VerbData.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md)\>

***

### delete()

> **delete**(`verb`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L209)

#### Parameters

##### verb

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### get()

> **get**(`verb`): [`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md) \| `null`\>

Defined in: [types/DO.ts:205](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L205)

#### Parameters

##### verb

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md) \| `null`\>

***

### list()

> **list**(): [`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md)[]\>

Defined in: [types/DO.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L206)

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md)[]\>

***

### update()

> **update**(`verb`, `data`): [`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md)\>

Defined in: [types/DO.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L208)

#### Parameters

##### verb

`string`

##### data

`Partial`\<[`VerbData`](VerbData.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Verb`](Verb.md)\>
