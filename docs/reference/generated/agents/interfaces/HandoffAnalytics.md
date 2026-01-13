[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffAnalytics

# Interface: HandoffAnalytics

Defined in: agents/handoff-chain.ts:122

Analytics for handoff patterns

## Properties

### agentParticipation

> **agentParticipation**: `object`[]

Defined in: agents/handoff-chain.ts:130

Agents ranked by handoff participation

#### agentId

> **agentId**: `string`

#### asSource

> **asSource**: `number`

#### asTarget

> **asTarget**: `number`

***

### averageChainLength?

> `optional` **averageChainLength**: `number`

Defined in: agents/handoff-chain.ts:132

Average chain length

***

### byReason

> **byReason**: `Record`\<`HandoffReason`, `number`\>

Defined in: agents/handoff-chain.ts:126

Handoffs grouped by reason

***

### topHandoffPairs

> **topHandoffPairs**: `object`[]

Defined in: agents/handoff-chain.ts:128

Most common handoff pairs (from -> to)

#### count

> **count**: `number`

#### from

> **from**: `string`

#### to

> **to**: `string`

***

### totalHandoffs

> **totalHandoffs**: `number`

Defined in: agents/handoff-chain.ts:124

Total handoffs in the system
