[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ServiceEscalationConfig

# Interface: ServiceEscalationConfig

Defined in: [objects/Service.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L149)

Escalation configuration

## Properties

### escalationTargets

> **escalationTargets**: `object`[]

Defined in: [objects/Service.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L152)

#### priority

> **priority**: `"low"` \| `"high"` \| `"urgent"` \| `"normal"`

#### target

> **target**: `string`

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [objects/Service.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L151)

***

### qualityThreshold?

> `optional` **qualityThreshold**: `number`

Defined in: [objects/Service.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L150)
