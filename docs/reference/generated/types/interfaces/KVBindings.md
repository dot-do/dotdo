[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / KVBindings

# Interface: KVBindings

Defined in: [types/CloudflareBindings.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L111)

KV (Key-Value) storage bindings

KV provides eventually consistent, low-latency key-value storage
suitable for caching, session storage, and configuration.

## Extended by

- [`StorageBindings`](StorageBindings.md)

## Properties

### CACHE?

> `optional` **CACHE**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L126)

Cache KV namespace for expensive computations

***

### KV?

> `optional` **KV**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L116)

Primary KV namespace for application data
Used for sessions, API key caching, rate limit state

***

### TEST\_KV?

> `optional` **TEST\_KV**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L121)

Test KV namespace (dev/test only)
