[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / SecretBindings

# Interface: SecretBindings

Defined in: [types/CloudflareBindings.ts:389](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L389)

Secret/environment variable bindings

These are typically configured via wrangler secrets or environment variables.

## Extended by

- [`CloudflareEnv`](CloudflareEnv.md)

## Properties

### BROWSERBASE\_API\_KEY?

> `optional` **BROWSERBASE\_API\_KEY**: `string`

Defined in: [types/CloudflareBindings.ts:408](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L408)

Browserbase API key for browser automation

***

### BROWSERBASE\_PROJECT\_ID?

> `optional` **BROWSERBASE\_PROJECT\_ID**: `string`

Defined in: [types/CloudflareBindings.ts:413](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L413)

Browserbase project ID

***

### PLATFORM\_FEE\_PERCENT?

> `optional` **PLATFORM\_FEE\_PERCENT**: `string`

Defined in: [types/CloudflareBindings.ts:403](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L403)

Platform fee percentage for payments

***

### STRIPE\_SECRET\_KEY?

> `optional` **STRIPE\_SECRET\_KEY**: `string`

Defined in: [types/CloudflareBindings.ts:393](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L393)

Stripe secret key for payments

***

### STRIPE\_WEBHOOK\_SECRET?

> `optional` **STRIPE\_WEBHOOK\_SECRET**: `string`

Defined in: [types/CloudflareBindings.ts:398](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L398)

Stripe webhook secret for verification
