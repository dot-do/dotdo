[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentResultMeta

# Interface: AgentResultMeta

Defined in: [agents/typed-result.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L76)

Metadata about an agent result

## Properties

### agent

> **agent**: `string`

Defined in: [agents/typed-result.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L78)

Agent name that produced the result

***

### durationMs?

> `optional` **durationMs**: `number`

Defined in: [agents/typed-result.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L82)

Execution time in milliseconds

***

### model?

> `optional` **model**: `string`

Defined in: [agents/typed-result.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L80)

Model used (if known)

***

### tokens?

> `optional` **tokens**: `object`

Defined in: [agents/typed-result.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L84)

Token usage (if available)

#### completion

> **completion**: `number`

#### prompt

> **prompt**: `number`

#### total

> **total**: `number`
