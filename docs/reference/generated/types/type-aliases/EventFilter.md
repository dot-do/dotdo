[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventFilter

# Type Alias: EventFilter()\<TPayload\>

> **EventFilter**\<`TPayload`\> = (`event`) => `boolean` \| `Promise`\<`boolean`\>

Defined in: [types/WorkflowContext.ts:535](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L535)

Filter predicate for conditional event handling
Returns true to allow the handler to execute, false to skip

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Parameters

### event

[`DomainEvent`](../interfaces/DomainEvent.md)\<`TPayload`\>

## Returns

`boolean` \| `Promise`\<`boolean`\>
