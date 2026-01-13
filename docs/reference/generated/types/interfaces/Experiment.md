[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Experiment

# Interface: Experiment

Defined in: [types/Experiment.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L23)

Experiment type for branch-based A/B testing

Uses git semantics where branches ARE variants. This enables:
- Version control for experiment variants
- Easy rollback and deployment
- Natural branching workflow for experiments

## Properties

### branches

> **branches**: `string`[]

Defined in: [types/Experiment.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L26)

***

### createdAt?

> `optional` **createdAt**: `Date`

Defined in: [types/Experiment.ts:31](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L31)

***

### id

> **id**: `string`

Defined in: [types/Experiment.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L24)

***

### metric

> **metric**: `string`

Defined in: [types/Experiment.ts:28](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L28)

***

### status

> **status**: [`ExperimentStatus`](../type-aliases/ExperimentStatus.md)

Defined in: [types/Experiment.ts:29](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L29)

***

### thing

> **thing**: `string`

Defined in: [types/Experiment.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L25)

***

### traffic

> **traffic**: `number`

Defined in: [types/Experiment.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L27)

***

### updatedAt?

> `optional` **updatedAt**: `Date`

Defined in: [types/Experiment.ts:32](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L32)

***

### winner?

> `optional` **winner**: `string`

Defined in: [types/Experiment.ts:30](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Experiment.ts#L30)
