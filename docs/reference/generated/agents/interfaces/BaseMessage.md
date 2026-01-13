[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BaseMessage

# Interface: BaseMessage

Defined in: [agents/types.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L43)

## Extended by

- [`UserMessage`](UserMessage.md)
- [`AssistantMessage`](AssistantMessage.md)
- [`SystemMessage`](SystemMessage.md)
- [`ToolMessage`](ToolMessage.md)

## Properties

### createdAt?

> `optional` **createdAt**: `Date`

Defined in: [agents/types.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L46)

***

### id?

> `optional` **id**: `string`

Defined in: [agents/types.ts:44](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L44)

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/types.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L47)

***

### role

> **role**: [`MessageRole`](../type-aliases/MessageRole.md)

Defined in: [agents/types.ts:45](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L45)
