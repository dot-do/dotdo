[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / buildItemId

# Function: buildItemId()

> **buildItemId**(`ns`, `id`): `string`

Defined in: [types/Collection.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L100)

Build an item ID in ns/id format (no type in path)

## Parameters

### ns

`string`

The namespace URL (e.g., 'https://startups.studio')

### id

`string`

The local ID (e.g., 'acme')

## Returns

`string`

Full ID in format `ns/id` (e.g., 'https://startups.studio/acme')
