[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / hashPipeline

# Function: hashPipeline()

> **hashPipeline**(`path`, `contextHash`, `args?`): `string`

Defined in: [workflows/hash.ts:170](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/hash.ts#L170)

Hash pipeline path and context to produce a step ID

The step ID is computed as:
sha256(JSON.stringify({ path, contextHash, argsHash? }))

## Parameters

### path

`string`[]

The pipeline path array (e.g., ["Inventory", "check"])

### contextHash

`string`

The hash of the execution context

### args?

`unknown`

Optional arguments to include in the hash

## Returns

`string`

A 64-character lowercase hex string (SHA-256)

## Example

```ts
hashPipeline(['Inventory', 'check'], 'a3f2c91b')
// => "5d41402a..." (64 chars)
```
