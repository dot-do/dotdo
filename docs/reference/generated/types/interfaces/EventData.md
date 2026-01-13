[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventData

# Interface: EventData

Defined in: [types/event.ts:264](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L264)

EventData - Partial event for creation (only requires mandatory fields)

## Properties

### actor

> **actor**: `string`

Defined in: [types/event.ts:266](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L266)

***

### branch?

> `optional` **branch**: `string`

Defined in: [types/event.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L291)

***

### cascade?

> `optional` **cascade**: [`EventCascade`](EventCascade.md)

Defined in: [types/event.ts:295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L295)

***

### channel?

> `optional` **channel**: `string`

Defined in: [types/event.ts:294](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L294)

***

### context?

> `optional` **context**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:297](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L297)

***

### destination?

> `optional` **destination**: `string`

Defined in: [types/event.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L268)

***

### disposition?

> `optional` **disposition**: `string`

Defined in: [types/event.ts:286](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L286)

***

### location?

> `optional` **location**: `string`

Defined in: [types/event.ts:281](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L281)

***

### method?

> `optional` **method**: [`FunctionMethod`](../type-aliases/FunctionMethod.md)

Defined in: [types/event.ts:290](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L290)

***

### model?

> `optional` **model**: `string`

Defined in: [types/event.ts:292](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L292)

***

### ns

> **ns**: `string`

Defined in: [types/event.ts:280](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L280)

***

### object

> **object**: `string`

Defined in: [types/event.ts:271](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L271)

***

### quantity?

> `optional` **quantity**: `number`

Defined in: [types/event.ts:273](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L273)

***

### readPoint?

> `optional` **readPoint**: `string`

Defined in: [types/event.ts:282](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L282)

***

### reason?

> `optional` **reason**: `string`

Defined in: [types/event.ts:287](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L287)

***

### recorded?

> `optional` **recorded**: `string` \| `Date`

Defined in: [types/event.ts:277](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L277)

***

### source?

> `optional` **source**: `string`

Defined in: [types/event.ts:267](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L267)

***

### timestamp?

> `optional` **timestamp**: `string` \| `Date`

Defined in: [types/event.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L276)

***

### tools?

> `optional` **tools**: `string`[]

Defined in: [types/event.ts:293](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L293)

***

### transaction?

> `optional` **transaction**: `string`

Defined in: [types/event.ts:296](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L296)

***

### type

> **type**: `string`

Defined in: [types/event.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L272)

***

### verb

> **verb**: `string`

Defined in: [types/event.ts:285](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L285)
