[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DigitalExtensions

# Interface: DigitalExtensions

Defined in: [types/event.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L72)

DigitalExtensions - Digital context fields extending the 5W+H model
These capture modern digital interaction context beyond physical supply chain

## Extended by

- [`ExtendedEvent`](ExtendedEvent.md)

## Properties

### actorType?

> `optional` **actorType**: [`ActorType`](../type-aliases/ActorType.md)

Defined in: [types/event.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L74)

Type of actor performing the action

***

### channelType?

> `optional` **channelType**: `string`

Defined in: [types/event.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L78)

Interaction channel

***

### confidence?

> `optional` **confidence**: `number`

Defined in: [types/event.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L76)

Confidence score for AI-generated events (0-1)

***

### device?

> `optional` **device**: `string` \| [`DeviceInfo`](DeviceInfo.md)

Defined in: [types/event.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L82)

Device information

***

### session?

> `optional` **session**: `string` \| [`SessionInfo`](SessionInfo.md)

Defined in: [types/event.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L80)

Session information
