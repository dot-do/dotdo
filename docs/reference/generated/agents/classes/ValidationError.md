[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ValidationError

# Class: ValidationError

Defined in: [agents/schema.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L200)

Custom validation error with path information

## Extends

- `Error`

## Constructors

### Constructor

> **new ValidationError**(`options`): `ValidationError`

Defined in: [agents/schema.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L208)

#### Parameters

##### options

###### expected?

`string`

###### message

`string`

###### path

(`string` \| `number`)[]

###### received?

`unknown`

#### Returns

`ValidationError`

#### Overrides

`Error.constructor`

## Methods

### toString()

> **toString**(): `string`

Defined in: [agents/schema.ts:224](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L224)

Format error as a readable string with path

#### Returns

`string`

## Properties

### expected

> `readonly` **expected**: `string`

Defined in: [agents/schema.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L206)

Expected type or constraint

***

### path

> `readonly` **path**: (`string` \| `number`)[]

Defined in: [agents/schema.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L202)

Path to the invalid field

***

### received

> `readonly` **received**: `unknown`

Defined in: [agents/schema.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L204)

The invalid value that was provided
