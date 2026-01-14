[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / StorageCapabilities

# Interface: StorageCapabilities

Defined in: [types/introspect.ts:211](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L211)

Storage capabilities available in the DO

## Properties

### bashx

> **bashx**: `boolean`

Defined in: [types/introspect.ts:217](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L217)

Shell without VMs (bashx)

***

### edgevec

> **edgevec**: `boolean`

Defined in: [types/introspect.ts:231](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L231)

Edge vector search

***

### fsx

> **fsx**: `boolean`

Defined in: [types/introspect.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L213)

Filesystem on SQLite (fsx)

***

### gitx

> **gitx**: `boolean`

Defined in: [types/introspect.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L215)

Git on R2 (gitx)

***

### iceberg

> **iceberg**: `boolean`

Defined in: [types/introspect.ts:229](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L229)

Apache Iceberg analytics

***

### r2

> **r2**: `object`

Defined in: [types/introspect.ts:219](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L219)

R2 object storage

#### buckets?

> `optional` **buckets**: `string`[]

#### enabled

> **enabled**: `boolean`

***

### sql

> **sql**: `object`

Defined in: [types/introspect.ts:224](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L224)

SQL/SQLite storage

#### enabled

> **enabled**: `boolean`

#### tables?

> `optional` **tables**: `string`[]
