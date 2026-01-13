[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowStateError

# Class: WorkflowStateError

Defined in: [objects/WorkflowRuntime.ts:233](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L233)

## Extends

- `Error`

## Constructors

### Constructor

> **new WorkflowStateError**(`currentState`, `attemptedAction`): `WorkflowStateError`

Defined in: [objects/WorkflowRuntime.ts:237](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L237)

#### Parameters

##### currentState

[`WorkflowRuntimeState`](../type-aliases/WorkflowRuntimeState.md)

##### attemptedAction

`string`

#### Returns

`WorkflowStateError`

#### Overrides

`Error.constructor`

## Properties

### attemptedAction

> `readonly` **attemptedAction**: `string`

Defined in: [objects/WorkflowRuntime.ts:235](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L235)

***

### currentState

> `readonly` **currentState**: [`WorkflowRuntimeState`](../type-aliases/WorkflowRuntimeState.md)

Defined in: [objects/WorkflowRuntime.ts:234](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L234)
