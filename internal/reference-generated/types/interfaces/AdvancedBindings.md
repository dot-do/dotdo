[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AdvancedBindings

# Interface: AdvancedBindings

Defined in: [types/CloudflareBindings.ts:373](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L373)

Combined advanced feature bindings

## Extends

- [`HyperdriveBindings`](HyperdriveBindings.md).[`RateLimitBindings`](RateLimitBindings.md).[`BrowserBindings`](BrowserBindings.md).[`AssetsBindings`](AssetsBindings.md).[`AnalyticsBindings`](AnalyticsBindings.md)

## Extended by

- [`CloudflareEnv`](CloudflareEnv.md)

## Properties

### ANALYTICS?

> `optional` **ANALYTICS**: `AnalyticsEngineDataset`

Defined in: [types/CloudflareBindings.ts:367](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L367)

Analytics Engine dataset binding

#### See

https://developers.cloudflare.com/analytics/analytics-engine/

#### Inherited from

[`AnalyticsBindings`](AnalyticsBindings.md).[`ANALYTICS`](AnalyticsBindings.md#analytics)

***

### ASSETS?

> `optional` **ASSETS**: `object`

Defined in: [types/CloudflareBindings.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L353)

Static assets fetcher

#### Inherited from

[`AssetsBindings`](AssetsBindings.md).[`ASSETS`](AssetsBindings.md#assets)

***

### BROWSER?

> `optional` **BROWSER**: `object`

Defined in: [types/CloudflareBindings.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L343)

Browser Rendering API binding

#### See

https://developers.cloudflare.com/browser-rendering/

#### Inherited from

[`BrowserBindings`](BrowserBindings.md).[`BROWSER`](BrowserBindings.md#browser)

***

### HYPERDRIVE?

> `optional` **HYPERDRIVE**: `Hyperdrive`

Defined in: [types/CloudflareBindings.ts:317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L317)

Hyperdrive connection to external database

#### See

https://developers.cloudflare.com/hyperdrive/

#### Inherited from

[`HyperdriveBindings`](HyperdriveBindings.md).[`HYPERDRIVE`](HyperdriveBindings.md#hyperdrive)

***

### RATE\_LIMIT?

> `optional` **RATE\_LIMIT**: `RateLimit`

Defined in: [types/CloudflareBindings.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L329)

Rate limiter binding

#### Inherited from

[`RateLimitBindings`](RateLimitBindings.md).[`RATE_LIMIT`](RateLimitBindings.md#rate_limit)
