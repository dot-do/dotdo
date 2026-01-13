[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MessageFilter

# Interface: MessageFilter

Defined in: [agents/communication.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L87)

Filter criteria for messages

## Properties

### limit?

> `optional` **limit**: `number`

Defined in: [agents/communication.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L99)

Limit results

***

### offset?

> `optional` **offset**: `number`

Defined in: [agents/communication.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L101)

Offset for pagination

***

### recipient?

> `optional` **recipient**: `string`

Defined in: [agents/communication.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L93)

Filter by recipient

***

### sender?

> `optional` **sender**: `string`

Defined in: [agents/communication.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L91)

Filter by sender

***

### since?

> `optional` **since**: `Date`

Defined in: [agents/communication.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L95)

Messages since this date

***

### type?

> `optional` **type**: [`MessageType`](../type-aliases/MessageType.md)

Defined in: [agents/communication.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L89)

Filter by message type

***

### until?

> `optional` **until**: `Date`

Defined in: [agents/communication.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L97)

Messages until this date
