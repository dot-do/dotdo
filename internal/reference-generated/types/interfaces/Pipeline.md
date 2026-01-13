[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Pipeline

# Interface: Pipeline

Defined in: [types/CloudflareBindings.ts:288](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L288)

Pipeline interface for event streaming

## Methods

### send()

> **send**(`data`): `Promise`\<`void`\>

Defined in: [types/CloudflareBindings.ts:293](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L293)

Send events to the pipeline

#### Parameters

##### data

`unknown`

Event data to stream

#### Returns

`Promise`\<`void`\>
