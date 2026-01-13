[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / JsonRpcNotification

# Interface: JsonRpcNotification

Defined in: [types/mcp.ts:297](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L297)

JSON-RPC 2.0 Notification (request without ID)

## Properties

### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [types/mcp.ts:298](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L298)

***

### method

> **method**: `string`

Defined in: [types/mcp.ts:300](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L300)

Method name

***

### params?

> `optional` **params**: `Record`\<`string`, `unknown`\>

Defined in: [types/mcp.ts:302](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L302)

Method parameters
