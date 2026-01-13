[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / JsonRpcMessage

# Interface: JsonRpcMessage

Defined in: [types/mcp.ts:253](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L253)

JSON-RPC 2.0 base message

## Properties

### error?

> `optional` **error**: [`JsonRpcError`](JsonRpcError.md)

Defined in: [types/mcp.ts:265](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L265)

Error (for error responses)

***

### id?

> `optional` **id**: `string` \| `number` \| `null`

Defined in: [types/mcp.ts:257](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L257)

Request/response ID

***

### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [types/mcp.ts:255](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L255)

JSON-RPC version (always '2.0')

***

### method?

> `optional` **method**: `string`

Defined in: [types/mcp.ts:259](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L259)

Method name (for requests/notifications)

***

### params?

> `optional` **params**: `Record`\<`string`, `unknown`\>

Defined in: [types/mcp.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L261)

Parameters (for requests/notifications)

***

### result?

> `optional` **result**: `unknown`

Defined in: [types/mcp.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L263)

Result (for responses)
