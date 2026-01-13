[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / NounId

# Type Alias: NounId

> **NounId** = `Brand`\<`string`, `"NounId"`\>

Defined in: [types/ids.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L75)

Branded type for Noun IDs.
Nouns define the schema/type for Things.

## Example

```ts
const id: NounId = createNounId('Startup')
const id: NounId = createNounId('Customer')
```
