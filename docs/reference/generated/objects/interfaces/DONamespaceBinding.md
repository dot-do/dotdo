[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / DONamespaceBinding

# Interface: DONamespaceBinding

Defined in: [workflows/StepDOBridge.ts:34](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L34)

Durable Object namespace binding interface

## Methods

### get()

> **get**(`id`): [`DOStub`](DOStub.md)

Defined in: [workflows/StepDOBridge.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L37)

#### Parameters

##### id

`DurableObjectId`

#### Returns

[`DOStub`](DOStub.md)

***

### idFromName()

> **idFromName**(`name`): `DurableObjectId`

Defined in: [workflows/StepDOBridge.ts:35](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L35)

#### Parameters

##### name

`string`

#### Returns

`DurableObjectId`

***

### idFromString()

> **idFromString**(`str`): `DurableObjectId`

Defined in: [workflows/StepDOBridge.ts:36](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L36)

#### Parameters

##### str

`string`

#### Returns

`DurableObjectId`
