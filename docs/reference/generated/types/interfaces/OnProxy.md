[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / OnProxy

# Interface: OnProxy

Defined in: [types/WorkflowContext.ts:633](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L633)

OnProxy - Provides typed noun access for event subscriptions

Supports wildcard patterns:
- $.on['*'].created - all nouns with 'created' verb
- $.on.Customer['*'] - all verbs for Customer noun
- $.on['*']['*'] - all events (global handler)

## Indexable

\[`Noun`: `string`\]: `TypedOnNounProxy`\<`string`\>
