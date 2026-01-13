[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EscalationConfig

# Interface: EscalationConfig

Defined in: [types/AIFunction.ts:315](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L315)

Escalation configuration for human tasks

## Properties

### after

> **after**: `string`

Defined in: [types/AIFunction.ts:317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L317)

Time after which to escalate (ISO 8601 duration)

***

### keepOriginal?

> `optional` **keepOriginal**: `boolean`

Defined in: [types/AIFunction.ts:323](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L323)

Whether to keep original assignee

***

### message?

> `optional` **message**: `string`

Defined in: [types/AIFunction.ts:321](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L321)

Escalation message

***

### to

> **to**: `string` \| `string`[]

Defined in: [types/AIFunction.ts:319](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L319)

Who to escalate to
