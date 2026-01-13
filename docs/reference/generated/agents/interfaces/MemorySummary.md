[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MemorySummary

# Interface: MemorySummary

Defined in: [agents/memory.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L69)

Summary of compressed conversation history

## Properties

### createdAt

> **createdAt**: `Date`

Defined in: [agents/memory.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L77)

When the summary was created

***

### messagesCovered

> **messagesCovered**: `number`

Defined in: [agents/memory.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L75)

Number of messages that were summarized

***

### summary

> **summary**: `string`

Defined in: [agents/memory.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L71)

Text summary of the conversation

***

### tokenCount

> **tokenCount**: `number`

Defined in: [agents/memory.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L73)

Approximate token count of the summary
