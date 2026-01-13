[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffContext

# Interface: HandoffContext

Defined in: [agents/handoff.ts:274](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L274)

Context transferred during a handoff

## Properties

### attachments?

> `optional` **attachments**: `object`[]

Defined in: [agents/handoff.ts:294](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L294)

Files or attachments to transfer

#### data?

> `optional` **data**: `string`

#### id

> **id**: `string`

#### mimeType

> **mimeType**: `string`

#### name

> **name**: `string`

#### url?

> `optional` **url**: `string`

***

### conversationId?

> `optional` **conversationId**: `string`

Defined in: [agents/handoff.ts:292](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L292)

Conversation/task ID for tracking

***

### instructions?

> `optional` **instructions**: `string`

Defined in: [agents/handoff.ts:286](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L286)

Specific instructions for target agent

***

### messages

> **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/handoff.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L276)

Conversation messages to transfer

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/handoff.ts:282](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L282)

Arbitrary metadata to preserve across handoffs

***

### preservedState?

> `optional` **preservedState**: [`PreservedState`](PreservedState.md)

Defined in: [agents/handoff.ts:290](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L290)

Preserved state for seamless transition

***

### summary?

> `optional` **summary**: `string`

Defined in: [agents/handoff.ts:284](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L284)

Summary of work done by source agent

***

### toolCalls?

> `optional` **toolCalls**: [`ToolCall`](ToolCall.md)[]

Defined in: [agents/handoff.ts:278](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L278)

Tool calls made by source agent

***

### toolResults?

> `optional` **toolResults**: [`ToolResult`](ToolResult.md)[]

Defined in: [agents/handoff.ts:280](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L280)

Tool results from source agent

***

### variables?

> `optional` **variables**: `Record`\<`string`, `unknown`\>

Defined in: [agents/handoff.ts:288](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L288)

Variables/state to pass along
