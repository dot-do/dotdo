[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffProtocolConfig

# Interface: HandoffProtocolConfig

Defined in: [agents/handoff.ts:416](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L416)

Configuration for the handoff protocol

## Properties

### ackTimeoutMs?

> `optional` **ackTimeoutMs**: `number`

Defined in: [agents/handoff.ts:434](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L434)

Timeout for waiting on acknowledgment in ms (default: 5000)

***

### agents

> **agents**: [`AgentConfig`](AgentConfig.md)[]

Defined in: [agents/handoff.ts:420](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L420)

Available agents that can be handed off to

***

### defaultTimeoutMs?

> `optional` **defaultTimeoutMs**: `number`

Defined in: [agents/handoff.ts:424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L424)

Default timeout for handoffs

***

### emitProtocolMessages?

> `optional` **emitProtocolMessages**: `boolean`

Defined in: [agents/handoff.ts:438](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L438)

Whether to emit protocol messages via hooks (default: true)

***

### hooks?

> `optional` **hooks**: [`HandoffHooks`](HandoffHooks.md)

Defined in: [agents/handoff.ts:422](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L422)

Hooks for customizing behavior

***

### includeFullHistory?

> `optional` **includeFullHistory**: `boolean`

Defined in: [agents/handoff.ts:428](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L428)

Whether to include full message history in context

***

### maxChainDepth?

> `optional` **maxChainDepth**: `number`

Defined in: [agents/handoff.ts:426](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L426)

Maximum chain depth to prevent infinite loops

***

### preserveState?

> `optional` **preserveState**: `boolean`

Defined in: [agents/handoff.ts:436](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L436)

Whether to preserve state during handoffs (default: true)

***

### provider

> **provider**: [`AgentProvider`](AgentProvider.md)

Defined in: [agents/handoff.ts:418](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L418)

Provider to use for creating target agents

***

### requireAcknowledgment?

> `optional` **requireAcknowledgment**: `boolean`

Defined in: [agents/handoff.ts:432](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L432)

Whether to require acknowledgment before proceeding (default: true)
