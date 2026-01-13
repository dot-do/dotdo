[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / JsonRpcRequest

# Interface: JsonRpcRequest

Defined in: [types/mcp.ts:271](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L271)

JSON-RPC 2.0 Request

## Properties

### id?

> `optional` **id**: `string` \| `number`

Defined in: [types/mcp.ts:274](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L274)

Request ID (required for requests, omit for notifications)

***

### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [types/mcp.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L272)

***

### method

> **method**: `string`

Defined in: [types/mcp.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L276)

Method name

***

### params?

> `optional` **params**: `Record`\<`string`, `unknown`\>

Defined in: [types/mcp.ts:278](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L278)

Method parameters (MCP requires object, not array)
