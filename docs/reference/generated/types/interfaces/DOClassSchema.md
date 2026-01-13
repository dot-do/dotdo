[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DOClassSchema

# Interface: DOClassSchema

Defined in: [types/introspect.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L65)

DOClassSchema - Describes a Durable Object class

## Properties

### actions

> **actions**: [`ActionSchema`](ActionSchema.md)[]

Defined in: [types/introspect.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L81)

Actions available on this class

***

### endpoints

> **endpoints**: [`RESTEndpointSchema`](RESTEndpointSchema.md)[]

Defined in: [types/introspect.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L77)

REST endpoints exposed by this class

***

### name

> **name**: `string`

Defined in: [types/introspect.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L67)

Class name (from static $type)

***

### pattern

> **pattern**: `string`

Defined in: [types/introspect.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L71)

URL pattern for accessing this class

***

### properties

> **properties**: [`PropertySchema`](PropertySchema.md)[]

Defined in: [types/introspect.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L79)

Properties/fields of this class

***

### tools

> **tools**: [`McpTool`](McpTool.md)[]

Defined in: [types/introspect.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L75)

MCP tools exposed by this class

***

### type

> **type**: `"thing"` \| `"collection"`

Defined in: [types/introspect.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L69)

Type: 'thing' for single-instance, 'collection' for multi-instance

***

### visibility

> **visibility**: [`VisibilityRole`](../type-aliases/VisibilityRole.md)

Defined in: [types/introspect.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L73)

Visibility level required to access this class
