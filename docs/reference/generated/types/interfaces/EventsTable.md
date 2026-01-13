[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventsTable

# Interface: EventsTable

Defined in: [types/DO.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L248)

## Methods

### get()

> **get**(`id`): [`RpcPromise`](RpcPromise.md)\<[`Event`](Event.md) \| `null`\>

Defined in: [types/DO.ts:249](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L249)

#### Parameters

##### id

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Event`](Event.md) \| `null`\>

***

### list()

> **list**(`query?`): [`RpcPromise`](RpcPromise.md)\<[`Event`](Event.md)[]\>

Defined in: [types/DO.ts:250](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L250)

#### Parameters

##### query?

###### source?

`string`

###### verb?

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Event`](Event.md)[]\>

***

### streamPending()

> **streamPending**(): [`RpcPromise`](RpcPromise.md)\<`number`\>

Defined in: [types/DO.ts:252](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L252)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`number`\>
