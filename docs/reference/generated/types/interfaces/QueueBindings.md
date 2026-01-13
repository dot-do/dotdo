[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / QueueBindings

# Interface: QueueBindings

Defined in: [types/CloudflareBindings.ts:237](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L237)

Queue bindings for async job processing

Queues provide reliable message delivery with retries
and dead letter queue support.

Queue operations are handled by lib/cloudflare/queues.ts

Queue Types:
- EVENTS_QUEUE: Domain event delivery to external systems
- JOBS_QUEUE: Background task processing (emails, reports, etc.)
- WEBHOOKS_QUEUE: External webhook delivery
- DLQ_QUEUE: Dead letter queue for failed messages

## Extended by

- [`MessagingBindings`](MessagingBindings.md)

## Properties

### ~~DLQ?~~

> `optional` **DLQ**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L272)

#### Deprecated

Use DLQ_QUEUE instead
Legacy binding for backward compatibility

***

### DLQ\_QUEUE?

> `optional` **DLQ\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L260)

Dead letter queue for failed messages
Queue: dotdo-dlq

***

### EVENTS\_QUEUE?

> `optional` **EVENTS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:242](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L242)

Events queue for domain event delivery
Queue: dotdo-events

***

### JOBS\_QUEUE?

> `optional` **JOBS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L248)

Jobs queue for background task processing
Queue: dotdo-jobs

***

### ~~QUEUE?~~

> `optional` **QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:266](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L266)

#### Deprecated

Use EVENTS_QUEUE instead
Legacy binding for backward compatibility

***

### WEBHOOKS\_QUEUE?

> `optional` **WEBHOOKS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:254](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L254)

Webhooks queue for external delivery
Queue: dotdo-webhooks
