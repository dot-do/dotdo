[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowTimeoutError

# Class: WorkflowTimeoutError

Defined in: [objects/WorkflowRuntime.ts:259](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L259)

## Extends

- `Error`

## Constructors

### Constructor

> **new WorkflowTimeoutError**(`timeoutMs`, `stepName?`): `WorkflowTimeoutError`

Defined in: [objects/WorkflowRuntime.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L263)

#### Parameters

##### timeoutMs

`number`

##### stepName?

`string`

#### Returns

`WorkflowTimeoutError`

#### Overrides

`Error.constructor`

## Properties

### stepName?

> `readonly` `optional` **stepName**: `string`

Defined in: [objects/WorkflowRuntime.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L260)

***

### timeoutMs

> `readonly` **timeoutMs**: `number`

Defined in: [objects/WorkflowRuntime.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L261)
