[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StepResultInput

# Interface: StepResultInput

Defined in: [workflows/StepResultStorage.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L23)

## Properties

### completedAt?

> `optional` **completedAt**: `Date`

Defined in: [workflows/StepResultStorage.ts:35](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L35)

When the step finished executing

***

### duration?

> `optional` **duration**: `number`

Defined in: [workflows/StepResultStorage.ts:29](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L29)

Execution duration in milliseconds

***

### error?

> `optional` **error**: `object`

Defined in: [workflows/StepResultStorage.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L37)

Error information if step failed

#### message

> **message**: `string`

#### name

> **name**: `string`

#### stack?

> `optional` **stack**: `string`

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [workflows/StepResultStorage.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L43)

Custom metadata

***

### output

> **output**: `unknown`

Defined in: [workflows/StepResultStorage.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L25)

The output value from the step

***

### retryCount?

> `optional` **retryCount**: `number`

Defined in: [workflows/StepResultStorage.ts:31](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L31)

Number of retry attempts

***

### startedAt?

> `optional` **startedAt**: `Date`

Defined in: [workflows/StepResultStorage.ts:33](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L33)

When the step started executing

***

### status

> **status**: [`StepStatus`](../type-aliases/StepStatus.md)

Defined in: [workflows/StepResultStorage.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L27)

Current status of the step
