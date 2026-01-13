[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ActionsTable

# Interface: ActionsTable

Defined in: [types/DO.ts:239](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L239)

## Methods

### create()

> **create**(`data`): [`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)\>

Defined in: [types/DO.ts:242](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L242)

#### Parameters

##### data

`Partial`\<[`Action`](Action.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)\>

***

### get()

> **get**(`id`): [`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md) \| `null`\>

Defined in: [types/DO.ts:240](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L240)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md) \| `null`\>

***

### list()

> **list**(`query?`): [`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)[]\>

Defined in: [types/DO.ts:241](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L241)

#### Parameters

##### query?

###### actor?

`string`

###### status?

`string`

###### target?

`string`

###### verb?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)[]\>

***

### undo()

> **undo**(`id`): [`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)\>

Defined in: [types/DO.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L245)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)\>

***

### update()

> **update**(`id`, `data`): [`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)\>

Defined in: [types/DO.ts:243](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L243)

#### Parameters

##### id

`string`

##### data

`Partial`\<[`Action`](Action.md)\>

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Action`](Action.md)\>
