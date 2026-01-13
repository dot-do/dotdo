[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RuntimeOptions

# Interface: RuntimeOptions

Defined in: [workflows/runtime.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L171)

Options for creating a workflow runtime

## Properties

### onStepComplete()?

> `optional` **onStepComplete**: (`stepId`, `result`) => `void`

Defined in: [workflows/runtime.ts:179](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L179)

Callback when step execution completes

#### Parameters

##### stepId

`string`

##### result

`unknown`

#### Returns

`void`

***

### onStepError()?

> `optional` **onStepError**: (`stepId`, `error`, `attempt`) => `void`

Defined in: [workflows/runtime.ts:181](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L181)

Callback when step execution fails

#### Parameters

##### stepId

`string`

##### error

`Error`

##### attempt

`number`

#### Returns

`void`

***

### onStepStart()?

> `optional` **onStepStart**: (`stepId`, `pipeline`) => `void`

Defined in: [workflows/runtime.ts:177](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L177)

Callback when step execution starts

#### Parameters

##### stepId

`string`

##### pipeline

[`Pipeline`](Pipeline.md)

#### Returns

`void`

***

### retryPolicy?

> `optional` **retryPolicy**: `Partial`\<[`RetryPolicy`](RetryPolicy.md)\>

Defined in: [workflows/runtime.ts:175](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L175)

Default retry policy for 'do' mode

***

### storage?

> `optional` **storage**: [`StepStorage`](StepStorage.md)

Defined in: [workflows/runtime.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L173)

Storage for step persistence (required for durable execution)
