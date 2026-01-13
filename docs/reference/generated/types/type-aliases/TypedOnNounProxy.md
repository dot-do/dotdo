[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / TypedOnNounProxy

# Type Alias: TypedOnNounProxy\<Noun\>

> **TypedOnNounProxy**\<`Noun`\> = `{ [Verb in string]: (handler: TypedEventHandler<TPayload>) => void }`

Defined in: [types/EventHandler.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L198)

Typed version of OnNounProxy for registering handlers.

## Type Parameters

### Noun

`Noun` *extends* `string`

The noun/entity name
