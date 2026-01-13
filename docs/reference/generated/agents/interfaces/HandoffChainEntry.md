[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffChainEntry

# Interface: HandoffChainEntry

Defined in: [agents/handoff.ts:360](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L360)

Entry in the handoff chain

## Properties

### agentId

> **agentId**: `string`

Defined in: [agents/handoff.ts:362](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L362)

Agent ID

***

### completedAt?

> `optional` **completedAt**: `Date`

Defined in: [agents/handoff.ts:366](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L366)

When this agent completed

***

### handoffReason?

> `optional` **handoffReason**: [`HandoffReason`](../type-aliases/HandoffReason.md)

Defined in: [agents/handoff.ts:370](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L370)

Reason for passing to next agent

***

### startedAt

> **startedAt**: `Date`

Defined in: [agents/handoff.ts:364](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L364)

When this agent started processing

***

### summary?

> `optional` **summary**: `string`

Defined in: [agents/handoff.ts:368](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L368)

Summary of what this agent did
