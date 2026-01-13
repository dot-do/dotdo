[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FlagContextInstance

# Interface: FlagContextInstance

Defined in: [workflows/context/flag.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L51)

Flag instance returned by $.flag('id')

## Methods

### disable()

> **disable**(): `Promise`\<`void`\>

Defined in: [workflows/context/flag.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L56)

#### Returns

`Promise`\<`void`\>

***

### enable()

> **enable**(): `Promise`\<`void`\>

Defined in: [workflows/context/flag.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L55)

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`userId`): `Promise`\<[`FlagEvaluation`](FlagEvaluation.md)\>

Defined in: [workflows/context/flag.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L53)

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<[`FlagEvaluation`](FlagEvaluation.md)\>

***

### isEnabled()

> **isEnabled**(`userId`): `Promise`\<`boolean`\>

Defined in: [workflows/context/flag.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L52)

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### setTraffic()

> **setTraffic**(`traffic`): `Promise`\<`void`\>

Defined in: [workflows/context/flag.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L54)

#### Parameters

##### traffic

`number`

#### Returns

`Promise`\<`void`\>
