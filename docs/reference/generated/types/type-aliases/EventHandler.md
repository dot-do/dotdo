[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventHandler

# Type Alias: EventHandler()\<TPayload\>

> **EventHandler**\<`TPayload`\> = (`event`) => `Promise`\<`void`\> \| `void`

Defined in: [types/WorkflowContext.ts:525](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L525)

Typed event handler function

## Type Parameters

### TPayload

`TPayload` = `unknown`

The expected payload type for this event

## Parameters

### event

[`DomainEvent`](../interfaces/DomainEvent.md)\<`TPayload`\>

## Returns

`Promise`\<`void`\> \| `void`
