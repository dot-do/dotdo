[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / StepResult

# Interface: StepResult

Defined in: [workflows/runtime.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L127)

Step execution result stored for replay

## Properties

### attempts

> **attempts**: `number`

Defined in: [workflows/runtime.ts:132](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L132)

***

### completedAt?

> `optional` **completedAt**: `number`

Defined in: [workflows/runtime.ts:134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L134)

***

### createdAt

> **createdAt**: `number`

Defined in: [workflows/runtime.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L133)

***

### error?

> `optional` **error**: `string`

Defined in: [workflows/runtime.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L131)

***

### result?

> `optional` **result**: `unknown`

Defined in: [workflows/runtime.ts:130](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L130)

***

### status

> **status**: `"pending"` \| `"completed"` \| `"failed"`

Defined in: [workflows/runtime.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L129)

***

### stepId

> **stepId**: `string`

Defined in: [workflows/runtime.ts:128](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L128)
