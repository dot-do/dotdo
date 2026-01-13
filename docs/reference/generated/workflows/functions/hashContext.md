[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / hashContext

# Function: hashContext()

> **hashContext**(`context`): `string`

Defined in: [workflows/hash.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/hash.ts#L150)

Hash a context object to produce a deterministic SHA-256 hash

## Parameters

### context

`unknown`

The context object to hash

## Returns

`string`

A 64-character lowercase hex string (SHA-256)

## Example

```ts
hashContext({ sku: 'ABC-123', quantity: 10 })
// => "a3f2c91b..." (64 chars)
```
