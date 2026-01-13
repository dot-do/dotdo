[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FlagInstance

# Interface: FlagInstance

Defined in: [workflows/flag.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L104)

Flag instance returned by $.flag(name)

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Defined in: [workflows/flag.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L110)

#### Returns

`Promise`\<`void`\>

***

### disable()

> **disable**(): `Promise`\<`void`\>

Defined in: [workflows/flag.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L107)

#### Returns

`Promise`\<`void`\>

***

### enable()

> **enable**(): `Promise`\<`void`\>

Defined in: [workflows/flag.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L106)

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(): `Promise`\<[`Flag`](Flag.md) \| `undefined`\>

Defined in: [workflows/flag.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L109)

#### Returns

`Promise`\<[`Flag`](Flag.md) \| `undefined`\>

***

### isEnabled()

> **isEnabled**(`userId`): `Promise`\<`boolean`\>

Defined in: [workflows/flag.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L105)

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### setTraffic()

> **setTraffic**(`traffic`): `Promise`\<`void`\>

Defined in: [workflows/flag.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/flag.ts#L108)

#### Parameters

##### traffic

`number`

#### Returns

`Promise`\<`void`\>
