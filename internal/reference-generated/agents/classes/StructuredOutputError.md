[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / StructuredOutputError

# Class: StructuredOutputError

Defined in: [agents/structured-output.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L52)

Structured output error with context for debugging and retry

## Extends

- `Error`

## Constructors

### Constructor

> **new StructuredOutputError**(`options`): `StructuredOutputError`

Defined in: [agents/structured-output.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L69)

#### Parameters

##### options

###### expected?

`string`

###### extractedJson?

`unknown`

###### message

`string`

###### path?

(`string` \| `number`)[]

###### phase

[`ParsePhase`](../type-aliases/ParsePhase.md)

###### rawOutput

`string`

###### received?

`unknown`

###### retryCount?

`number`

#### Returns

`StructuredOutputError`

#### Overrides

`Error.constructor`

## Methods

### toString()

> **toString**(): `string`

Defined in: [agents/structured-output.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L89)

Returns a string representation of an object.

#### Returns

`string`

## Properties

### expected?

> `readonly` `optional` **expected**: `string`

Defined in: [agents/structured-output.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L63)

Expected type or value

***

### extractedJson?

> `readonly` `optional` **extractedJson**: `unknown`

Defined in: [agents/structured-output.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L59)

Extracted JSON before validation (if extraction succeeded)

***

### name

> `readonly` **name**: `"StructuredOutputError"` = `'StructuredOutputError'`

Defined in: [agents/structured-output.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L53)

#### Overrides

`Error.name`

***

### path?

> `readonly` `optional` **path**: (`string` \| `number`)[]

Defined in: [agents/structured-output.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L61)

Path to the invalid field (for validation errors)

***

### phase

> `readonly` **phase**: [`ParsePhase`](../type-aliases/ParsePhase.md)

Defined in: [agents/structured-output.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L55)

Phase where parsing failed

***

### rawOutput

> `readonly` **rawOutput**: `string`

Defined in: [agents/structured-output.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L57)

Original raw output from AI

***

### received?

> `readonly` `optional` **received**: `unknown`

Defined in: [agents/structured-output.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L65)

Received value

***

### retryCount?

> `readonly` `optional` **retryCount**: `number`

Defined in: [agents/structured-output.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L67)

Number of retry attempts made
