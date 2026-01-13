[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / StructuredOutputOptions

# Interface: StructuredOutputOptions\<T\>

Defined in: [agents/structured-output.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L107)

Options for structured output parsing

## Type Parameters

### T

`T` = `unknown`

## Properties

### coerce?

> `optional` **coerce**: `boolean`

Defined in: [agents/structured-output.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L109)

Enable type coercion for common AI output quirks

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [agents/structured-output.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L111)

Maximum retry attempts when parsing fails

***

### onError()?

> `optional` **onError**: (`error`) => `Promise`\<`string`\>

Defined in: [agents/structured-output.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L113)

Callback to fix malformed output (e.g., ask AI to correct)

#### Parameters

##### error

[`StructuredOutputError`](../classes/StructuredOutputError.md)

#### Returns

`Promise`\<`string`\>

***

### transform()?

> `optional` **transform**: (`data`) => `unknown`

Defined in: [agents/structured-output.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L115)

Transform the parsed data after validation

#### Parameters

##### data

`T`

#### Returns

`unknown`
