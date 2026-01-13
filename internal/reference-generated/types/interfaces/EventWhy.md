[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventWhy

# Interface: EventWhy

Defined in: [types/event.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L159)

WHY fields - Business context for why the event occurred
Maps to EPCIS: bizStep, disposition

## Extended by

- [`FiveWHEvent`](FiveWHEvent.md)

## Properties

### disposition?

> `optional` **disposition**: `string`

Defined in: [types/event.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L163)

Current disposition/status (maps to disposition)

***

### reason?

> `optional` **reason**: `string`

Defined in: [types/event.ts:165](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L165)

Human-readable reason for the event

***

### verb

> **verb**: `string`

Defined in: [types/event.ts:161](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L161)

The action verb (created, updated, shipped, etc.) - maps to bizStep
