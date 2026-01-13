[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / FiveWHEvent

# Interface: FiveWHEvent

Defined in: [types/event.ts:250](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L250)

Complete Event interface combining all 5W+H fields

## Extends

- [`EventWho`](EventWho.md).[`EventWhat`](EventWhat.md).[`EventWhen`](EventWhen.md).[`EventWhere`](EventWhere.md).[`EventWhy`](EventWhy.md).[`EventHow`](EventHow.md)

## Extended by

- [`ExtendedEvent`](ExtendedEvent.md)

## Properties

### actor

> **actor**: `string`

Defined in: [types/event.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L95)

The actor who triggered the event (user ID, agent ID, etc.)

#### Inherited from

[`EventWho`](EventWho.md).[`actor`](EventWho.md#actor)

***

### branch?

> `optional` **branch**: `string`

Defined in: [types/event.ts:196](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L196)

Branch/experiment variant

#### Inherited from

[`EventHow`](EventHow.md).[`branch`](EventHow.md#branch)

***

### cascade?

> `optional` **cascade**: [`EventCascade`](EventCascade.md)

Defined in: [types/event.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L204)

Cascade tracking for fallback execution

#### Inherited from

[`EventHow`](EventHow.md).[`cascade`](EventHow.md#cascade)

***

### channel?

> `optional` **channel**: `string`

Defined in: [types/event.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L202)

Communication channel (for human method)

#### Inherited from

[`EventHow`](EventHow.md).[`channel`](EventHow.md#channel)

***

### context?

> `optional` **context**: `Record`\<`string`, `unknown`\>

Defined in: [types/event.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L208)

Additional context data

#### Inherited from

[`EventHow`](EventHow.md).[`context`](EventHow.md#context)

***

### destination?

> `optional` **destination**: `string`

Defined in: [types/event.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L99)

Destination URL/endpoint where the event is being sent

#### Inherited from

[`EventWho`](EventWho.md).[`destination`](EventWho.md#destination)

***

### disposition?

> `optional` **disposition**: `string`

Defined in: [types/event.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L163)

Current disposition/status (maps to disposition)

#### Inherited from

[`EventWhy`](EventWhy.md).[`disposition`](EventWhy.md#disposition)

***

### location?

> `optional` **location**: `string`

Defined in: [types/event.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L146)

Physical or logical location (maps to bizLocation)

#### Inherited from

[`EventWhere`](EventWhere.md).[`location`](EventWhere.md#location)

***

### method?

> `optional` **method**: [`FunctionMethod`](../type-aliases/FunctionMethod.md)

Defined in: [types/event.ts:194](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L194)

Execution method (code, generative, agentic, human)

#### Inherited from

[`EventHow`](EventHow.md).[`method`](EventHow.md#method)

***

### model?

> `optional` **model**: `string`

Defined in: [types/event.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L198)

AI model used (for generative/agentic methods)

#### Inherited from

[`EventHow`](EventHow.md).[`model`](EventHow.md#model)

***

### ns

> **ns**: `string`

Defined in: [types/event.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L144)

Namespace URL (required)

#### Inherited from

[`EventWhere`](EventWhere.md).[`ns`](EventWhere.md#ns)

***

### object

> **object**: `string`

Defined in: [types/event.ts:112](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L112)

The object identifier (Sqid reference, URN, etc.)

#### Inherited from

[`EventWhat`](EventWhat.md).[`object`](EventWhat.md#object)

***

### quantity?

> `optional` **quantity**: `number`

Defined in: [types/event.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L116)

Quantity when applicable

#### Inherited from

[`EventWhat`](EventWhat.md).[`quantity`](EventWhat.md#quantity)

***

### readPoint?

> `optional` **readPoint**: `string`

Defined in: [types/event.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L148)

Read point - where the event was captured (maps to readPoint)

#### Inherited from

[`EventWhere`](EventWhere.md).[`readPoint`](EventWhere.md#readpoint)

***

### reason?

> `optional` **reason**: `string`

Defined in: [types/event.ts:165](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L165)

Human-readable reason for the event

#### Inherited from

[`EventWhy`](EventWhy.md).[`reason`](EventWhy.md#reason)

***

### recorded?

> `optional` **recorded**: `string` \| `Date`

Defined in: [types/event.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L131)

When the event was recorded (recordTime)

#### Inherited from

[`EventWhen`](EventWhen.md).[`recorded`](EventWhen.md#recorded)

***

### source?

> `optional` **source**: `string`

Defined in: [types/event.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L97)

Source URL/endpoint where the event originated

#### Inherited from

[`EventWho`](EventWho.md).[`source`](EventWho.md#source)

***

### timestamp?

> `optional` **timestamp**: `string` \| `Date`

Defined in: [types/event.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L129)

When the event occurred (eventTime)

#### Inherited from

[`EventWhen`](EventWhen.md).[`timestamp`](EventWhen.md#timestamp)

***

### tools?

> `optional` **tools**: `string`[]

Defined in: [types/event.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L200)

Tools available (for agentic method)

#### Inherited from

[`EventHow`](EventHow.md).[`tools`](EventHow.md#tools)

***

### transaction?

> `optional` **transaction**: `string`

Defined in: [types/event.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L206)

Business transaction ID (maps to bizTransaction)

#### Inherited from

[`EventHow`](EventHow.md).[`transaction`](EventHow.md#transaction)

***

### type

> **type**: `string`

Defined in: [types/event.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L114)

The type of object (Noun name, EPCIS event type)

#### Inherited from

[`EventWhat`](EventWhat.md).[`type`](EventWhat.md#type)

***

### verb

> **verb**: `string`

Defined in: [types/event.ts:161](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L161)

The action verb (created, updated, shipped, etc.) - maps to bizStep

#### Inherited from

[`EventWhy`](EventWhy.md).[`verb`](EventWhy.md#verb)
