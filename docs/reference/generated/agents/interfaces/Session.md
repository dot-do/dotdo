[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / Session

# Interface: Session

Defined in: [agents/types.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L213)

## Properties

### agentId

> **agentId**: `string`

Defined in: [agents/types.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L215)

***

### attachments?

> `optional` **attachments**: [`Attachment`](Attachment.md)[]

Defined in: [agents/types.ts:225](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L225)

Devin-specific: attached files

***

### createdAt

> **createdAt**: `Date`

Defined in: [agents/types.ts:217](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L217)

***

### id

> **id**: `string`

Defined in: [agents/types.ts:214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L214)

***

### knowledgeIds?

> `optional` **knowledgeIds**: `string`[]

Defined in: [agents/types.ts:223](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L223)

Devin-specific: knowledge IDs

***

### messages

> **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/types.ts:219](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L219)

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/types.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L220)

***

### playbookId?

> `optional` **playbookId**: `string`

Defined in: [agents/types.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L227)

Devin-specific: playbook

***

### status

> **status**: [`SessionStatus`](../type-aliases/SessionStatus.md)

Defined in: [agents/types.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L216)

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [agents/types.ts:218](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L218)
