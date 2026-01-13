[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / Memory

# Interface: Memory

Defined in: [objects/Agent.ts:187](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Agent.ts#L187)

Legacy Memory interface for ctx.storage-based memory.
New code should use the unified AgentMemory via setMemory().

## Properties

### content

> **content**: `string`

Defined in: [objects/Agent.ts:190](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Agent.ts#L190)

***

### createdAt

> **createdAt**: `Date`

Defined in: [objects/Agent.ts:192](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Agent.ts#L192)

***

### embedding?

> `optional` **embedding**: `number`[]

Defined in: [objects/Agent.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Agent.ts#L191)

***

### id

> **id**: `string`

Defined in: [objects/Agent.ts:188](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Agent.ts#L188)

***

### type

> **type**: `"short-term"` \| `"long-term"` \| `"episodic"`

Defined in: [objects/Agent.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Agent.ts#L189)
