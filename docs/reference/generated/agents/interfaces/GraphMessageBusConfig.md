[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / GraphMessageBusConfig

# Interface: GraphMessageBusConfig

Defined in: [agents/communication.ts:416](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L416)

Configuration for message bus

## Extends

- [`BusConfig`](BusConfig.md)

## Properties

### defaultTtlMs?

> `optional` **defaultTtlMs**: `number`

Defined in: [agents/communication.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L126)

Default TTL for messages in milliseconds

#### Inherited from

[`BusConfig`](BusConfig.md).[`defaultTtlMs`](BusConfig.md#defaultttlms)

***

### graph

> **graph**: `GraphEngine`

Defined in: [agents/communication.ts:418](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L418)

Graph engine for persistence

***

### maxDeliveryAttempts?

> `optional` **maxDeliveryAttempts**: `number`

Defined in: [agents/communication.ts:128](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L128)

Maximum delivery attempts

#### Inherited from

[`BusConfig`](BusConfig.md).[`maxDeliveryAttempts`](BusConfig.md#maxdeliveryattempts)

***

### retryDelayMs?

> `optional` **retryDelayMs**: `number`

Defined in: [agents/communication.ts:130](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L130)

Retry delay in milliseconds

#### Inherited from

[`BusConfig`](BusConfig.md).[`retryDelayMs`](BusConfig.md#retrydelayms)
