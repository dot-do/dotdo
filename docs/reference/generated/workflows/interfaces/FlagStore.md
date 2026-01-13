[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FlagStore

# Interface: FlagStore

Defined in: [workflows/flag.ts:36](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L36)

Flag store interface for persistence

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [workflows/flag.ts:39](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L39)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`id`): `Promise`\<[`Flag`](Flag.md) \| `undefined`\>

Defined in: [workflows/flag.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L37)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`Flag`](Flag.md) \| `undefined`\>

***

### has()

> **has**(`id`): `Promise`\<`boolean`\>

Defined in: [workflows/flag.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L41)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### list()

> **list**(): `Promise`\<[`Flag`](Flag.md)[]\>

Defined in: [workflows/flag.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L40)

#### Returns

`Promise`\<[`Flag`](Flag.md)[]\>

***

### set()

> **set**(`id`, `flag`): `Promise`\<`void`\>

Defined in: [workflows/flag.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L38)

#### Parameters

##### id

`string`

##### flag

[`Flag`](Flag.md)

#### Returns

`Promise`\<`void`\>
