[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MessageEnvelope

# Interface: MessageEnvelope\<T\>

Defined in: [agents/communication.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L67)

Envelope wrapping a message with delivery metadata

## Type Parameters

### T

`T` = `unknown`

## Properties

### createdAt

> **createdAt**: `Date`

Defined in: [agents/communication.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L73)

When the envelope was created

***

### deliveredAt?

> `optional` **deliveredAt**: `Date`

Defined in: [agents/communication.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L77)

When the message was delivered (if applicable)

***

### deliveryAttempts

> **deliveryAttempts**: `number`

Defined in: [agents/communication.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L71)

Number of delivery attempts

***

### error?

> `optional` **error**: `string`

Defined in: [agents/communication.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L79)

Error message if delivery failed

***

### message

> **message**: [`AgentMessage`](AgentMessage.md)\<`T`\>

Defined in: [agents/communication.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L69)

The wrapped message

***

### receipt?

> `optional` **receipt**: [`DeliveryReceipt`](DeliveryReceipt.md)

Defined in: [agents/communication.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L81)

Delivery receipt from recipient

***

### status

> **status**: [`DeliveryStatus`](../type-aliases/DeliveryStatus.md)

Defined in: [agents/communication.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L75)

Current delivery status
