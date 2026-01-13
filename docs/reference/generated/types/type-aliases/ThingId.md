[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ThingId

# Type Alias: ThingId

> **ThingId** = `Brand`\<`string`, `"ThingId"`\>

Defined in: [types/ids.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L47)

Branded type for Thing IDs.
Things are the core data entities with versioning.

## Example

```ts
const id: ThingId = createThingId('acme')
const id: ThingId = createThingId('headless.ly')
```
