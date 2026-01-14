[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HandlerOptions

# Interface: HandlerOptions\<TPayload\>

Defined in: [types/WorkflowContext.ts:540](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L540)

Options for enhanced event handler registration

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### filter?

> `optional` **filter**: [`EventFilter`](../type-aliases/EventFilter.md)\<`TPayload`\>

Defined in: [types/WorkflowContext.ts:544](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L544)

Filter predicate for conditional handling

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [types/WorkflowContext.ts:548](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L548)

Maximum retry attempts when handler fails (for DLQ integration)

***

### name?

> `optional` **name**: `string`

Defined in: [types/WorkflowContext.ts:546](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L546)

Handler name for debugging and metadata tracking

***

### priority?

> `optional` **priority**: `number`

Defined in: [types/WorkflowContext.ts:542](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L542)

Priority for execution ordering (higher = runs first, default: 0)
