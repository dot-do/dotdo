[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventWhen

# Interface: EventWhen

Defined in: [types/event.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L127)

WHEN fields - Timestamps for the event
Maps to EPCIS: eventTime, recordTime

## Extended by

- [`FiveWHEvent`](FiveWHEvent.md)

## Properties

### recorded?

> `optional` **recorded**: `string` \| `Date`

Defined in: [types/event.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L131)

When the event was recorded (recordTime)

***

### timestamp?

> `optional` **timestamp**: `string` \| `Date`

Defined in: [types/event.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L129)

When the event occurred (eventTime)
