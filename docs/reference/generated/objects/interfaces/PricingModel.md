[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / PricingModel

# Interface: PricingModel

Defined in: [objects/Service.ts:39](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L39)

Pricing model for the service

## Properties

### basePrice?

> `optional` **basePrice**: `number`

Defined in: [objects/Service.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L41)

***

### currency?

> `optional` **currency**: `string`

Defined in: [objects/Service.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L43)

***

### pricePerTask?

> `optional` **pricePerTask**: `number`

Defined in: [objects/Service.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L42)

***

### tiers?

> `optional` **tiers**: [`PricingTier`](PricingTier.md)[]

Defined in: [objects/Service.ts:44](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L44)

***

### type

> **type**: `"per-task"` \| `"subscription"` \| `"usage-based"` \| `"hybrid"`

Defined in: [objects/Service.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Service.ts#L40)
