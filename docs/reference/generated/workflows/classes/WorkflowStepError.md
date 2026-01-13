[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowStepError

# Class: WorkflowStepError

Defined in: [workflows/runtime.ts:542](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L542)

Error thrown when a workflow step fails after all retries

## Extends

- `Error`

## Constructors

### Constructor

> **new WorkflowStepError**(`message`, `cause`, `stepId`, `attempts`): `WorkflowStepError`

Defined in: [workflows/runtime.ts:543](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L543)

#### Parameters

##### message

`string`

##### cause

`Error` | `undefined`

##### stepId

`string`

##### attempts

`number`

#### Returns

`WorkflowStepError`

#### Overrides

`Error.constructor`

## Properties

### attempts

> **attempts**: `number`

Defined in: [workflows/runtime.ts:547](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L547)

***

### cause

> **cause**: `Error` \| `undefined`

Defined in: [workflows/runtime.ts:545](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L545)

#### Inherited from

`Error.cause`

***

### stepId

> **stepId**: `string`

Defined in: [workflows/runtime.ts:546](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L546)
