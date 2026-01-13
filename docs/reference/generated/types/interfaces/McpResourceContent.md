[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / McpResourceContent

# Interface: McpResourceContent

Defined in: [types/mcp.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L141)

MCP Resource content (as returned by resources/read)

## Properties

### blob?

> `optional` **blob**: `string`

Defined in: [types/mcp.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L149)

Base64 blob (for binary resources)

***

### mimeType?

> `optional` **mimeType**: `string`

Defined in: [types/mcp.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L145)

MIME type

***

### text?

> `optional` **text**: `string`

Defined in: [types/mcp.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L147)

Text content (for text resources)

***

### uri

> **uri**: `string`

Defined in: [types/mcp.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L143)

Resource URI
