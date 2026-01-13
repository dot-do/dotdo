[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventWhere

# Interface: EventWhere

Defined in: [types/event.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L142)

WHERE fields - Location context for the event
Maps to EPCIS: readPoint, bizLocation

## Extended by

- [`FiveWHEvent`](FiveWHEvent.md)

## Properties

### location?

> `optional` **location**: `string`

Defined in: [types/event.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L146)

Physical or logical location (maps to bizLocation)

***

### ns

> **ns**: `string`

Defined in: [types/event.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L144)

Namespace URL (required)

***

### readPoint?

> `optional` **readPoint**: `string`

Defined in: [types/event.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L148)

Read point - where the event was captured (maps to readPoint)
