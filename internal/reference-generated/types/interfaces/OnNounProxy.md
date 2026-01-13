[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / OnNounProxy

# Interface: OnNounProxy\<Noun\>

Defined in: [types/WorkflowContext.ts:603](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L603)

OnNounProxy - Provides typed verb access for a specific noun

When EventPayloadMap is extended with typed events, the handler
will receive properly typed event payloads.

Enhanced to support optional HandlerOptions as second parameter.

## Type Parameters

### Noun

`Noun` *extends* `string` = `string`

## Indexable

\[`verb`: `string`\]: (`handler`, `options?`) => `void`
