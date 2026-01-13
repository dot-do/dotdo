[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ToolInvocation

# Interface: ToolInvocation\<T\>

Defined in: [types/AIFunction.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L123)

Tool invocation result

## Type Parameters

### T

`T` = `unknown`

## Properties

### durationMs

> **durationMs**: `number`

Defined in: [types/AIFunction.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L131)

Duration of tool execution in ms

***

### error?

> `optional` **error**: `string`

Defined in: [types/AIFunction.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L135)

Error message if failed

***

### input

> **input**: `unknown`

Defined in: [types/AIFunction.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L127)

Input provided to the tool

***

### output

> **output**: `T`

Defined in: [types/AIFunction.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L129)

Output from the tool

***

### success

> **success**: `boolean`

Defined in: [types/AIFunction.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L133)

Whether the invocation succeeded

***

### tool

> **tool**: `string`

Defined in: [types/AIFunction.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L125)

Tool name that was invoked
