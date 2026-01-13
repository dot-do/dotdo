[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventHow

# Interface: EventHow

Defined in: [types/event.ts:192](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L192)

HOW fields - Technical context for how the event was processed
Maps to EPCIS: bizTransaction (partially)

## Extended by

- [`FiveWHEvent`](FiveWHEvent.md)

## Properties

### branch?

> `optional` **branch**: `string`

Defined in: [types/event.ts:196](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L196)

Branch/experiment variant

***

### cascade?

> `optional` **cascade**: [`EventCascade`](EventCascade.md)

Defined in: [types/event.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L204)

Cascade tracking for fallback execution

***

### channel?

> `optional` **channel**: `string`

Defined in: [types/event.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L202)

Communication channel (for human method)

***

### context?

> `optional` **context**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L208)

Additional context data

***

### method?

> `optional` **method**: [`FunctionMethod`](../type-aliases/FunctionMethod.md)

Defined in: [types/event.ts:194](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L194)

Execution method (code, generative, agentic, human)

***

### model?

> `optional` **model**: `string`

Defined in: [types/event.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L198)

AI model used (for generative/agentic methods)

***

### tools?

> `optional` **tools**: `string`[]

Defined in: [types/event.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L200)

Tools available (for agentic method)

***

### transaction?

> `optional` **transaction**: `string`

Defined in: [types/event.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L206)

Business transaction ID (maps to bizTransaction)
