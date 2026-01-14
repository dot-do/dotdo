[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / FileStats

# Interface: FileStats

Defined in: [types/capabilities.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L90)

File statistics returned by stat operations.

## Properties

### atime

> **atime**: `Date`

Defined in: [types/capabilities.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L119)

Last access time.

***

### ctime

> **ctime**: `Date`

Defined in: [types/capabilities.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L114)

Creation time.

***

### isDirectory

> **isDirectory**: `boolean`

Defined in: [types/capabilities.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L99)

True if the path points to a directory.

***

### isFile

> **isFile**: `boolean`

Defined in: [types/capabilities.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L94)

True if the path points to a file.

***

### mtime

> **mtime**: `Date`

Defined in: [types/capabilities.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L109)

Last modification time.

***

### size

> **size**: `number`

Defined in: [types/capabilities.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L104)

Size of the file in bytes.
