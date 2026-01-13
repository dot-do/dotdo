[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventWho

# Interface: EventWho

Defined in: [types/event.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L93)

WHO fields - Identifies the actor and endpoints
Maps to EPCIS: source, destination

## Extended by

- [`FiveWHEvent`](FiveWHEvent.md)

## Properties

### actor

> **actor**: `string`

Defined in: [types/event.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L95)

The actor who triggered the event (user ID, agent ID, etc.)

***

### destination?

> `optional` **destination**: `string`

Defined in: [types/event.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L99)

Destination URL/endpoint where the event is being sent

***

### source?

> `optional` **source**: `string`

Defined in: [types/event.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L97)

Source URL/endpoint where the event originated
