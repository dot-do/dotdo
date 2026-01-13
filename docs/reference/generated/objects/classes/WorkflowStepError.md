[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowStepError

# Class: WorkflowStepError

Defined in: [objects/WorkflowRuntime.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L245)

## Extends

- `Error`

## Constructors

### Constructor

> **new WorkflowStepError**(`stepName`, `stepIndex`, `cause?`): `WorkflowStepError`

Defined in: [objects/WorkflowRuntime.ts:250](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L250)

#### Parameters

##### stepName

`string`

##### stepIndex

`number`

##### cause?

`Error`

#### Returns

`WorkflowStepError`

#### Overrides

`Error.constructor`

## Properties

### cause?

> `readonly` `optional` **cause**: `Error`

Defined in: [objects/WorkflowRuntime.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L248)

#### Overrides

`Error.cause`

***

### stepIndex

> `readonly` **stepIndex**: `number`

Defined in: [objects/WorkflowRuntime.ts:247](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L247)

***

### stepName

> `readonly` **stepName**: `string`

Defined in: [objects/WorkflowRuntime.ts:246](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L246)
