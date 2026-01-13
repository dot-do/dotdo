[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / hashArgs

# Function: hashArgs()

> **hashArgs**(`args`): `string`

Defined in: [workflows/hash.ts:203](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/hash.ts#L203)

Hash arbitrary arguments for deterministic step identification

Handles all types:
- Primitives: string, number, boolean, null
- Special: undefined (serialized as "__undefined__")
- Complex: objects, arrays, nested structures

Type information is preserved, so "123" and 123 produce different hashes.

## Parameters

### args

`unknown`

Any value to hash

## Returns

`string`

A 64-character lowercase hex string (SHA-256)

## Example

```ts
hashArgs({ quantity: 10 })
// => "b3a8e0e1..." (64 chars)

hashArgs([1, 2, 3])
// => "cd2eb0c9..." (64 chars)
```
