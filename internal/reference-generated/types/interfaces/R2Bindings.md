[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / R2Bindings

# Interface: R2Bindings

Defined in: [types/CloudflareBindings.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L135)

R2 (Object Storage) bindings

R2 provides S3-compatible object storage with zero egress fees.
Used for archives, file uploads, and large data storage.

## Extended by

- [`StorageBindings`](StorageBindings.md)

## Properties

### ARCHIVES?

> `optional` **ARCHIVES**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L145)

Archives R2 bucket for historical data

***

### R2?

> `optional` **R2**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L140)

Primary R2 bucket for application data
Used for compact() archives, file uploads, Iceberg tables

***

### UPLOADS?

> `optional` **UPLOADS**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L150)

Uploads R2 bucket for user file uploads
