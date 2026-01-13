[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExtendedEvent

# Interface: ExtendedEvent

Defined in: [types/event.ts:256](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L256)

ExtendedEvent - Event with digital extensions and custom dimensions
This is the full event type for modern digital applications

## Extends

- [`FiveWHEvent`](FiveWHEvent.md).[`DigitalExtensions`](DigitalExtensions.md)

## Properties

### actor

> **actor**: `string`

Defined in: [types/event.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L95)

The actor who triggered the event (user ID, agent ID, etc.)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`actor`](FiveWHEvent.md#actor)

***

### actorType?

> `optional` **actorType**: [`ActorType`](../type-aliases/ActorType.md)

Defined in: [types/event.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L74)

Type of actor performing the action

#### Inherited from

[`DigitalExtensions`](DigitalExtensions.md).[`actorType`](DigitalExtensions.md#actortype)

***

### branch?

> `optional` **branch**: `string`

Defined in: [types/event.ts:196](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L196)

Branch/experiment variant

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`branch`](FiveWHEvent.md#branch)

***

### cascade?

> `optional` **cascade**: [`EventCascade`](EventCascade.md)

Defined in: [types/event.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L204)

Cascade tracking for fallback execution

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`cascade`](FiveWHEvent.md#cascade)

***

### channel?

> `optional` **channel**: `string`

Defined in: [types/event.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L202)

Communication channel (for human method)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`channel`](FiveWHEvent.md#channel)

***

### channelType?

> `optional` **channelType**: `string`

Defined in: [types/event.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L78)

Interaction channel

#### Inherited from

[`DigitalExtensions`](DigitalExtensions.md).[`channelType`](DigitalExtensions.md#channeltype)

***

### confidence?

> `optional` **confidence**: `number`

Defined in: [types/event.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L76)

Confidence score for AI-generated events (0-1)

#### Inherited from

[`DigitalExtensions`](DigitalExtensions.md).[`confidence`](DigitalExtensions.md#confidence)

***

### context?

> `optional` **context**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L208)

Additional context data

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`context`](FiveWHEvent.md#context)

***

### destination?

> `optional` **destination**: `string`

Defined in: [types/event.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L99)

Destination URL/endpoint where the event is being sent

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`destination`](FiveWHEvent.md#destination)

***

### device?

> `optional` **device**: `string` \| [`DeviceInfo`](DeviceInfo.md)

Defined in: [types/event.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L82)

Device information

#### Inherited from

[`DigitalExtensions`](DigitalExtensions.md).[`device`](DigitalExtensions.md#device)

***

### disposition?

> `optional` **disposition**: `string`

Defined in: [types/event.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L163)

Current disposition/status (maps to disposition)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`disposition`](FiveWHEvent.md#disposition)

***

### extensions?

> `optional` **extensions**: [`EventExtensions`](EventExtensions.md)

Defined in: [types/event.ts:258](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L258)

Custom extensions for domain-specific context

***

### location?

> `optional` **location**: `string`

Defined in: [types/event.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L146)

Physical or logical location (maps to bizLocation)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`location`](FiveWHEvent.md#location)

***

### method?

> `optional` **method**: [`FunctionMethod`](../type-aliases/FunctionMethod.md)

Defined in: [types/event.ts:194](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L194)

Execution method (code, generative, agentic, human)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`method`](FiveWHEvent.md#method)

***

### model?

> `optional` **model**: `string`

Defined in: [types/event.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L198)

AI model used (for generative/agentic methods)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`model`](FiveWHEvent.md#model)

***

### ns

> **ns**: `string`

Defined in: [types/event.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L144)

Namespace URL (required)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`ns`](FiveWHEvent.md#ns)

***

### object

> **object**: `string`

Defined in: [types/event.ts:112](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L112)

The object identifier (Sqid reference, URN, etc.)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`object`](FiveWHEvent.md#object)

***

### quantity?

> `optional` **quantity**: `number`

Defined in: [types/event.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L116)

Quantity when applicable

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`quantity`](FiveWHEvent.md#quantity)

***

### readPoint?

> `optional` **readPoint**: `string`

Defined in: [types/event.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L148)

Read point - where the event was captured (maps to readPoint)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`readPoint`](FiveWHEvent.md#readpoint)

***

### reason?

> `optional` **reason**: `string`

Defined in: [types/event.ts:165](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L165)

Human-readable reason for the event

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`reason`](FiveWHEvent.md#reason)

***

### recorded?

> `optional` **recorded**: `string` \| `Date`

Defined in: [types/event.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L131)

When the event was recorded (recordTime)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`recorded`](FiveWHEvent.md#recorded)

***

### session?

> `optional` **session**: `string` \| [`SessionInfo`](SessionInfo.md)

Defined in: [types/event.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L80)

Session information

#### Inherited from

[`DigitalExtensions`](DigitalExtensions.md).[`session`](DigitalExtensions.md#session)

***

### source?

> `optional` **source**: `string`

Defined in: [types/event.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L97)

Source URL/endpoint where the event originated

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`source`](FiveWHEvent.md#source)

***

### timestamp?

> `optional` **timestamp**: `string` \| `Date`

Defined in: [types/event.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L129)

When the event occurred (eventTime)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`timestamp`](FiveWHEvent.md#timestamp)

***

### tools?

> `optional` **tools**: `string`[]

Defined in: [types/event.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L200)

Tools available (for agentic method)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`tools`](FiveWHEvent.md#tools)

***

### transaction?

> `optional` **transaction**: `string`

Defined in: [types/event.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L206)

Business transaction ID (maps to bizTransaction)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`transaction`](FiveWHEvent.md#transaction)

***

### type

> **type**: `string`

Defined in: [types/event.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L114)

The type of object (Noun name, EPCIS event type)

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`type`](FiveWHEvent.md#type)

***

### verb

> **verb**: `string`

Defined in: [types/event.ts:161](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L161)

The action verb (created, updated, shipped, etc.) - maps to bizStep

#### Inherited from

[`FiveWHEvent`](FiveWHEvent.md).[`verb`](FiveWHEvent.md#verb)
