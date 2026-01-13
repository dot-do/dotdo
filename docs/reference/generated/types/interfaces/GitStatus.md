[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GitStatus

# Interface: GitStatus

Defined in: [types/capabilities.ts:321](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L321)

Git repository status information.

## Properties

### branch

> **branch**: `string`

Defined in: [types/capabilities.ts:325](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L325)

Current branch name.

***

### detached?

> `optional` **detached**: `boolean`

Defined in: [types/capabilities.ts:345](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L345)

True if HEAD is detached (not on a branch).

***

### staged

> **staged**: `string`[]

Defined in: [types/capabilities.ts:330](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L330)

Files that have been staged for commit.

***

### unstaged

> **unstaged**: `string`[]

Defined in: [types/capabilities.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L335)

Files with unstaged changes.

***

### untracked?

> `optional` **untracked**: `string`[]

Defined in: [types/capabilities.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L340)

Untracked files not yet added to git.
