[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventExtensions

# Interface: EventExtensions

Defined in: [types/event.ts:234](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L234)

EventExtensions - Container for custom dimensions
Provides a structured way to add domain-specific context

## Properties

### dimensions?

> `optional` **dimensions**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:236](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L236)

Custom dimensions keyed by namespace:key

***

### domain?

> `optional` **domain**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:240](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L240)

Domain-specific extensions

***

### epcis?

> `optional` **epcis**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:238](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L238)

EPCIS-style extensions
