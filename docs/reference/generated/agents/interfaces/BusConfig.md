[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BusConfig

# Interface: BusConfig

Defined in: [agents/communication.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L124)

Configuration for message bus

## Extended by

- [`GraphMessageBusConfig`](GraphMessageBusConfig.md)

## Properties

### defaultTtlMs?

> `optional` **defaultTtlMs**: `number`

Defined in: [agents/communication.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L126)

Default TTL for messages in milliseconds

***

### maxDeliveryAttempts?

> `optional` **maxDeliveryAttempts**: `number`

Defined in: [agents/communication.ts:128](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L128)

Maximum delivery attempts

***

### retryDelayMs?

> `optional` **retryDelayMs**: `number`

Defined in: [agents/communication.ts:130](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L130)

Retry delay in milliseconds
