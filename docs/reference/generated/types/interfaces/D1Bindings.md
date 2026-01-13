[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / D1Bindings

# Interface: D1Bindings

Defined in: [types/CloudflareBindings.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L159)

D1 (SQLite Database) bindings

D1 provides a serverless SQL database built on SQLite.
Used for global relational data that doesn't fit the DO model.

## Extended by

- [`StorageBindings`](StorageBindings.md)

## Properties

### ANALYTICS\_DB?

> `optional` **ANALYTICS\_DB**: `D1Database`

Defined in: [types/CloudflareBindings.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L168)

Analytics D1 database for read-heavy queries

***

### DB?

> `optional` **DB**: `D1Database`

Defined in: [types/CloudflareBindings.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L163)

Primary D1 database for global data
