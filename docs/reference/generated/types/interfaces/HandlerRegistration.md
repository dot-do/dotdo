[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HandlerRegistration

# Interface: HandlerRegistration\<TPayload\>

Defined in: [types/WorkflowContext.ts:554](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L554)

Handler registration metadata tracked by the system

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### executionCount

> **executionCount**: `number`

Defined in: [types/WorkflowContext.ts:572](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L572)

Total execution count

***

### failureCount

> **failureCount**: `number`

Defined in: [types/WorkflowContext.ts:576](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L576)

Failed execution count

***

### filter?

> `optional` **filter**: [`EventFilter`](../type-aliases/EventFilter.md)\<`TPayload`\>

Defined in: [types/WorkflowContext.ts:566](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L566)

Optional filter predicate

***

### handler

> **handler**: [`EventHandler`](../type-aliases/EventHandler.md)\<`TPayload`\>

Defined in: [types/WorkflowContext.ts:564](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L564)

The handler function itself

***

### lastExecutedAt?

> `optional` **lastExecutedAt**: `number`

Defined in: [types/WorkflowContext.ts:570](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L570)

Last execution timestamp (epoch ms)

***

### maxRetries

> **maxRetries**: `number`

Defined in: [types/WorkflowContext.ts:568](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L568)

Maximum retries for DLQ (default: 3)

***

### name

> **name**: `string`

Defined in: [types/WorkflowContext.ts:556](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L556)

Handler name (from options or generated)

***

### priority

> **priority**: `number`

Defined in: [types/WorkflowContext.ts:558](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L558)

Handler priority (default: 0)

***

### registeredAt

> **registeredAt**: `number`

Defined in: [types/WorkflowContext.ts:560](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L560)

Registration timestamp (epoch ms)

***

### sourceNs

> **sourceNs**: `string`

Defined in: [types/WorkflowContext.ts:562](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L562)

Source DO namespace that registered this handler

***

### successCount

> **successCount**: `number`

Defined in: [types/WorkflowContext.ts:574](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L574)

Successful execution count
