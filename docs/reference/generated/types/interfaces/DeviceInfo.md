[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DeviceInfo

# Interface: DeviceInfo

Defined in: [types/event.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L55)

DeviceInfo - Device context for events

## Properties

### id

> **id**: `string`

Defined in: [types/event.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L57)

Unique device identifier

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L65)

Additional device metadata

***

### model?

> `optional` **model**: `string`

Defined in: [types/event.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L63)

Device model/version

***

### platform?

> `optional` **platform**: `string`

Defined in: [types/event.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L61)

Device platform (iOS, Android, Windows, etc.)

***

### type?

> `optional` **type**: `string`

Defined in: [types/event.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L59)

Device type (desktop, mobile, tablet, iot, scanner, etc.)
