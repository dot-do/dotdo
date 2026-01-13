[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AssistantMessage

# Interface: AssistantMessage

Defined in: [agents/types.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L55)

## Extends

- [`BaseMessage`](BaseMessage.md)

## Properties

### content?

> `optional` **content**: `string`

Defined in: [agents/types.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L57)

***

### createdAt?

> `optional` **createdAt**: `Date`

Defined in: [agents/types.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L46)

#### Inherited from

[`BaseMessage`](BaseMessage.md).[`createdAt`](BaseMessage.md#createdat)

***

### id?

> `optional` **id**: `string`

Defined in: [agents/types.ts:44](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L44)

#### Inherited from

[`BaseMessage`](BaseMessage.md).[`id`](BaseMessage.md#id)

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/types.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L47)

#### Inherited from

[`BaseMessage`](BaseMessage.md).[`metadata`](BaseMessage.md#metadata)

***

### role

> **role**: `"assistant"`

Defined in: [agents/types.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L56)

#### Overrides

[`BaseMessage`](BaseMessage.md).[`role`](BaseMessage.md#role)

***

### toolCalls?

> `optional` **toolCalls**: [`ToolCall`](ToolCall.md)[]

Defined in: [agents/types.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L58)
