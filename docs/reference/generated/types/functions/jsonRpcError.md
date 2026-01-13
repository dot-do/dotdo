[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / jsonRpcError

# Function: jsonRpcError()

> **jsonRpcError**(`id`, `code`, `message`, `data?`): [`JsonRpcResponse`](../interfaces/JsonRpcResponse.md)

Defined in: [types/mcp.ts:413](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L413)

Create a JSON-RPC error response

## Parameters

### id

`string` | `number` | `null`

### code

`number`

### message

`string`

### data?

`unknown`

## Returns

[`JsonRpcResponse`](../interfaces/JsonRpcResponse.md)
