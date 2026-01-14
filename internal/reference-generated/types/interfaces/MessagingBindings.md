[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / MessagingBindings

# Interface: MessagingBindings

Defined in: [types/CloudflareBindings.ts:299](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L299)

Combined messaging bindings

## Extends

- [`QueueBindings`](QueueBindings.md).[`PipelineBindings`](PipelineBindings.md)

## Extended by

- [`CloudflareEnv`](CloudflareEnv.md)

## Properties

### ~~DLQ?~~

> `optional` **DLQ**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L272)

#### Deprecated

Use DLQ_QUEUE instead
Legacy binding for backward compatibility

#### Inherited from

[`QueueBindings`](QueueBindings.md).[`DLQ`](QueueBindings.md#dlq)

***

### DLQ\_QUEUE?

> `optional` **DLQ\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L260)

Dead letter queue for failed messages
Queue: dotdo-dlq

#### Inherited from

[`QueueBindings`](QueueBindings.md).[`DLQ_QUEUE`](QueueBindings.md#dlq_queue)

***

### EVENTS\_QUEUE?

> `optional` **EVENTS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:242](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L242)

Events queue for domain event delivery
Queue: dotdo-events

#### Inherited from

[`QueueBindings`](QueueBindings.md).[`EVENTS_QUEUE`](QueueBindings.md#events_queue)

***

### JOBS\_QUEUE?

> `optional` **JOBS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L248)

Jobs queue for background task processing
Queue: dotdo-jobs

#### Inherited from

[`QueueBindings`](QueueBindings.md).[`JOBS_QUEUE`](QueueBindings.md#jobs_queue)

***

### PIPELINE?

> `optional` **PIPELINE**: [`Pipeline`](Pipeline.md)

Defined in: [types/CloudflareBindings.ts:282](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L282)

Primary pipeline for event streaming

#### Inherited from

[`PipelineBindings`](PipelineBindings.md).[`PIPELINE`](PipelineBindings.md#pipeline)

***

### ~~QUEUE?~~

> `optional` **QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:266](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L266)

#### Deprecated

Use EVENTS_QUEUE instead
Legacy binding for backward compatibility

#### Inherited from

[`QueueBindings`](QueueBindings.md).[`QUEUE`](QueueBindings.md#queue)

***

### WEBHOOKS\_QUEUE?

> `optional` **WEBHOOKS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:254](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L254)

Webhooks queue for external delivery
Queue: dotdo-webhooks

#### Inherited from

[`QueueBindings`](QueueBindings.md).[`WEBHOOKS_QUEUE`](QueueBindings.md#webhooks_queue)
