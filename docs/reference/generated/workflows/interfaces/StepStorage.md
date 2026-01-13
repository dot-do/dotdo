[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / StepStorage

# Interface: StepStorage

Defined in: [workflows/runtime.ts:156](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L156)

Storage interface for step persistence

## Methods

### delete()

> **delete**(`stepId`): `Promise`\<`void`\>

Defined in: [workflows/runtime.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L159)

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`stepId`): `Promise`\<[`StepResult`](StepResult.md) \| `undefined`\>

Defined in: [workflows/runtime.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L157)

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<[`StepResult`](StepResult.md) \| `undefined`\>

***

### list()

> **list**(): `Promise`\<[`StepResult`](StepResult.md)[]\>

Defined in: [workflows/runtime.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L160)

#### Returns

`Promise`\<[`StepResult`](StepResult.md)[]\>

***

### set()

> **set**(`stepId`, `result`): `Promise`\<`void`\>

Defined in: [workflows/runtime.ts:158](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L158)

#### Parameters

##### stepId

`string`

##### result

[`StepResult`](StepResult.md)

#### Returns

`Promise`\<`void`\>
