[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GitCommit

# Interface: GitCommit

Defined in: [types/capabilities.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L351)

A single commit in the git log.

## Properties

### author?

> `optional` **author**: `string`

Defined in: [types/capabilities.ts:375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L375)

Commit author name.

***

### body?

> `optional` **body**: `string`

Defined in: [types/capabilities.ts:370](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L370)

Full commit message including body.

***

### date?

> `optional` **date**: `Date`

Defined in: [types/capabilities.ts:385](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L385)

Commit timestamp.

***

### email?

> `optional` **email**: `string`

Defined in: [types/capabilities.ts:380](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L380)

Commit author email.

***

### hash

> **hash**: `string`

Defined in: [types/capabilities.ts:355](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L355)

Full commit hash (SHA-1).

***

### message

> **message**: `string`

Defined in: [types/capabilities.ts:365](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L365)

Commit message (first line).

***

### shortHash?

> `optional` **shortHash**: `string`

Defined in: [types/capabilities.ts:360](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L360)

Short commit hash (typically 7 characters).
