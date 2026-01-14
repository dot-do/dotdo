[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StoredStepResult

# Interface: StoredStepResult

Defined in: [workflows/StepResultStorage.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L46)

## Properties

### completedAt?

> `optional` **completedAt**: `Date`

Defined in: [workflows/StepResultStorage.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L60)

When the step finished executing

***

### duration?

> `optional` **duration**: `number`

Defined in: [workflows/StepResultStorage.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L54)

Execution duration in milliseconds

***

### error?

> `optional` **error**: `object`

Defined in: [workflows/StepResultStorage.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L62)

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

Defined in: [workflows/StepResultStorage.ts:68](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L68)

Custom metadata

***

### output

> **output**: `unknown`

Defined in: [workflows/StepResultStorage.ts:50](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L50)

The output value from the step

***

### retryCount?

> `optional` **retryCount**: `number`

Defined in: [workflows/StepResultStorage.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L56)

Number of retry attempts

***

### startedAt?

> `optional` **startedAt**: `Date`

Defined in: [workflows/StepResultStorage.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L58)

When the step started executing

***

### status

> **status**: [`StepStatus`](../type-aliases/StepStatus.md)

Defined in: [workflows/StepResultStorage.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L52)

Current status of the step

***

### stepName

> **stepName**: `string`

Defined in: [workflows/StepResultStorage.ts:48](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L48)

The step name

***

### storedAt?

> `optional` **storedAt**: `string`

Defined in: [workflows/StepResultStorage.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepResultStorage.ts#L70)

When the result was stored
