[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / hashToInt

# Function: hashToInt()

> **hashToInt**(`input`): `number`

Defined in: [workflows/hash.ts:222](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/hash.ts#L222)

Hash a string to produce a deterministic non-negative integer.
Useful for traffic allocation and bucket assignment in experiments.

Uses SHA-256 internally and extracts the first 8 hex characters
to produce a 32-bit unsigned integer.

## Parameters

### input

`string`

The string to hash

## Returns

`number`

A non-negative integer (0 to 4294967295)

## Example

```ts
hashToInt('user:123:experiment:test')
// => 2847593815
```
