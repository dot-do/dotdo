[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / JSONSchema

# Interface: JSONSchema

Defined in: [types/AIFunction.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L37)

JSON Schema definition with type inference support

## Properties

### $defs?

> `optional` **$defs**: `Record`\<`string`, `JSONSchema`\>

Defined in: [types/AIFunction.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L57)

***

### $ref?

> `optional` **$ref**: `string`

Defined in: [types/AIFunction.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L56)

***

### additionalProperties?

> `optional` **additionalProperties**: `boolean` \| `JSONSchema`

Defined in: [types/AIFunction.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L52)

***

### allOf?

> `optional` **allOf**: `JSONSchema`[]

Defined in: [types/AIFunction.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L55)

***

### anyOf?

> `optional` **anyOf**: `JSONSchema`[]

Defined in: [types/AIFunction.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L54)

***

### const?

> `optional` **const**: `unknown`

Defined in: [types/AIFunction.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L43)

***

### default?

> `optional` **default**: `unknown`

Defined in: [types/AIFunction.ts:45](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L45)

***

### description?

> `optional` **description**: `string`

Defined in: [types/AIFunction.ts:44](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L44)

***

### enum?

> `optional` **enum**: readonly `unknown`[]

Defined in: [types/AIFunction.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L42)

***

### format?

> `optional` **format**: `string`

Defined in: [types/AIFunction.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L51)

***

### items?

> `optional` **items**: `JSONSchema`

Defined in: [types/AIFunction.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L40)

***

### maximum?

> `optional` **maximum**: `number`

Defined in: [types/AIFunction.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L47)

***

### maxLength?

> `optional` **maxLength**: `number`

Defined in: [types/AIFunction.ts:49](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L49)

***

### minimum?

> `optional` **minimum**: `number`

Defined in: [types/AIFunction.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L46)

***

### minLength?

> `optional` **minLength**: `number`

Defined in: [types/AIFunction.ts:48](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L48)

***

### oneOf?

> `optional` **oneOf**: `JSONSchema`[]

Defined in: [types/AIFunction.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L53)

***

### pattern?

> `optional` **pattern**: `string`

Defined in: [types/AIFunction.ts:50](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L50)

***

### properties?

> `optional` **properties**: `Record`\<`string`, `JSONSchema`\>

Defined in: [types/AIFunction.ts:39](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L39)

***

### required?

> `optional` **required**: readonly `string`[]

Defined in: [types/AIFunction.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L41)

***

### type?

> `optional` **type**: [`JSONSchemaType`](../type-aliases/JSONSchemaType.md) \| [`JSONSchemaType`](../type-aliases/JSONSchemaType.md)[]

Defined in: [types/AIFunction.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L38)
