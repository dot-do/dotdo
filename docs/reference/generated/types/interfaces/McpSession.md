[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / McpSession

# Interface: McpSession

Defined in: [types/mcp.ts:187](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L187)

MCP Session state (for HTTP Streamable transport)

## Properties

### capabilities?

> `optional` **capabilities**: `Record`\<`string`, `unknown`\>

Defined in: [types/mcp.ts:201](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L201)

Session capabilities

***

### clientInfo?

> `optional` **clientInfo**: [`McpClientInfo`](McpClientInfo.md)

Defined in: [types/mcp.ts:197](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L197)

Client information

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/mcp.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L191)

Session creation time

***

### id

> **id**: `string`

Defined in: [types/mcp.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L189)

Unique session identifier

***

### lastAccessedAt

> **lastAccessedAt**: `Date`

Defined in: [types/mcp.ts:193](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L193)

Last access time

***

### lastActivity?

> `optional` **lastActivity**: `Date`

Defined in: [types/mcp.ts:195](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L195)

Last activity time

***

### protocolVersion?

> `optional` **protocolVersion**: `string`

Defined in: [types/mcp.ts:199](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L199)

Protocol version

***

### resources?

> `optional` **resources**: `Map`\<`string`, [`McpResource`](McpResource.md)\>

Defined in: [types/mcp.ts:205](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L205)

Available resources for this session

***

### subscriptions?

> `optional` **subscriptions**: `string`[]

Defined in: [types/mcp.ts:207](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L207)

Active subscriptions

***

### tools?

> `optional` **tools**: `Map`\<`string`, [`McpTool`](McpTool.md)\>

Defined in: [types/mcp.ts:203](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L203)

Registered tools for this session
