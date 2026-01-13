[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / McpContent

# Interface: McpContent

Defined in: [types/mcp.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L107)

Content block in a tool result

## Properties

### data?

> `optional` **data**: `string`

Defined in: [types/mcp.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L113)

Base64-encoded data (for type: 'image')

***

### mimeType?

> `optional` **mimeType**: `string`

Defined in: [types/mcp.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L115)

MIME type for binary content

***

### text?

> `optional` **text**: `string`

Defined in: [types/mcp.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L111)

Text content (for type: 'text')

***

### type

> **type**: `"text"` \| `"image"` \| `"resource"`

Defined in: [types/mcp.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L109)

Content type

***

### uri?

> `optional` **uri**: `string`

Defined in: [types/mcp.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L117)

Resource URI (for type: 'resource')
