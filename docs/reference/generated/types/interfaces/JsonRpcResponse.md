[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / JsonRpcResponse

# Interface: JsonRpcResponse

Defined in: [types/mcp.ts:284](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L284)

JSON-RPC 2.0 Response

## Properties

### error?

> `optional` **error**: [`JsonRpcError`](JsonRpcError.md)

Defined in: [types/mcp.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L291)

Error (present on failure)

***

### id

> **id**: `string` \| `number` \| `null`

Defined in: [types/mcp.ts:287](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L287)

Request ID (null for notifications/errors without ID)

***

### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [types/mcp.ts:285](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L285)

***

### result?

> `optional` **result**: `unknown`

Defined in: [types/mcp.ts:289](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L289)

Result (present on success)
