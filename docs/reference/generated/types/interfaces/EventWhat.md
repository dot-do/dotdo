[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventWhat

# Interface: EventWhat

Defined in: [types/event.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L110)

WHAT fields - Identifies what the event is about
Maps to EPCIS: epcList, parentID, quantity

## Extended by

- [`FiveWHEvent`](FiveWHEvent.md)

## Properties

### object

> **object**: `string`

Defined in: [types/event.ts:112](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L112)

The object identifier (Sqid reference, URN, etc.)

***

### quantity?

> `optional` **quantity**: `number`

Defined in: [types/event.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L116)

Quantity when applicable

***

### type

> **type**: `string`

Defined in: [types/event.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L114)

The type of object (Noun name, EPCIS event type)
