[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / SpawnedProcess

# Interface: SpawnedProcess

Defined in: [types/capabilities.ts:691](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L691)

A spawned child process handle.

## Methods

### kill()

> **kill**(`signal?`): `boolean`

Defined in: [types/capabilities.ts:700](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L700)

Send a signal to the process.

#### Parameters

##### signal?

`string`

#### Returns

`boolean`

***

### wait()

> **wait**(): `Promise`\<[`ExecResult`](ExecResult.md)\>

Defined in: [types/capabilities.ts:710](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L710)

Wait for the process to complete.

#### Returns

`Promise`\<[`ExecResult`](ExecResult.md)\>

***

### write()?

> `optional` **write**(`data`): `void`

Defined in: [types/capabilities.ts:705](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L705)

Write to the process stdin.

#### Parameters

##### data

`string` | `Buffer`\<`ArrayBufferLike`\>

#### Returns

`void`

## Properties

### pid

> **pid**: `number`

Defined in: [types/capabilities.ts:695](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L695)

Process ID.

***

### stderr?

> `optional` **stderr**: `AsyncIterable`\<`string`, `any`, `any`\>

Defined in: [types/capabilities.ts:720](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L720)

Standard error stream (if available).

***

### stdout?

> `optional` **stdout**: `AsyncIterable`\<`string`, `any`, `any`\>

Defined in: [types/capabilities.ts:715](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L715)

Standard output stream (if available).
