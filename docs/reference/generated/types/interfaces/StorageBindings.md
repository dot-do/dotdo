[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / StorageBindings

# Interface: StorageBindings

Defined in: [types/CloudflareBindings.ts:174](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L174)

Combined storage bindings

## Extends

- [`KVBindings`](KVBindings.md).[`R2Bindings`](R2Bindings.md).[`D1Bindings`](D1Bindings.md)

## Extended by

- [`CloudflareEnv`](CloudflareEnv.md)

## Properties

### ANALYTICS\_DB?

> `optional` **ANALYTICS\_DB**: `D1Database`

Defined in: [types/CloudflareBindings.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L168)

Analytics D1 database for read-heavy queries

#### Inherited from

[`D1Bindings`](D1Bindings.md).[`ANALYTICS_DB`](D1Bindings.md#analytics_db)

***

### ARCHIVES?

> `optional` **ARCHIVES**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L145)

Archives R2 bucket for historical data

#### Inherited from

[`R2Bindings`](R2Bindings.md).[`ARCHIVES`](R2Bindings.md#archives)

***

### CACHE?

> `optional` **CACHE**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L126)

Cache KV namespace for expensive computations

#### Inherited from

[`KVBindings`](KVBindings.md).[`CACHE`](KVBindings.md#cache)

***

### DB?

> `optional` **DB**: `D1Database`

Defined in: [types/CloudflareBindings.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L163)

Primary D1 database for global data

#### Inherited from

[`D1Bindings`](D1Bindings.md).[`DB`](D1Bindings.md#db)

***

### KV?

> `optional` **KV**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L116)

Primary KV namespace for application data
Used for sessions, API key caching, rate limit state

#### Inherited from

[`KVBindings`](KVBindings.md).[`KV`](KVBindings.md#kv)

***

### R2?

> `optional` **R2**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L140)

Primary R2 bucket for application data
Used for compact() archives, file uploads, Iceberg tables

#### Inherited from

[`R2Bindings`](R2Bindings.md).[`R2`](R2Bindings.md#r2)

***

### TEST\_KV?

> `optional` **TEST\_KV**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L121)

Test KV namespace (dev/test only)

#### Inherited from

[`KVBindings`](KVBindings.md).[`TEST_KV`](KVBindings.md#test_kv)

***

### UPLOADS?

> `optional` **UPLOADS**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L150)

Uploads R2 bucket for user file uploads

#### Inherited from

[`R2Bindings`](R2Bindings.md).[`UPLOADS`](R2Bindings.md#uploads)
