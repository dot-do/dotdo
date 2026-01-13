[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DO

# Interface: DO

Defined in: [types/DO.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L101)

## Extends

- `RpcTarget`

## Indexable

\[`noun`: `string`\]: `unknown`

## Methods

### collection()

> **collection**\<`T`\>(`noun`): [`ThingsCollection`](../type-aliases/ThingsCollection.md)\<`T`\>

Defined in: [types/DO.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L129)

#### Type Parameters

##### T

`T` *extends* [`Thing`](Thing.md) = [`Thing`](Thing.md)

#### Parameters

##### noun

`string`

#### Returns

[`ThingsCollection`](../type-aliases/ThingsCollection.md)\<`T`\>

***

### initialize()

> **initialize**(`config`): [`RpcPromise`](RpcPromise.md)\<`void`\>

Defined in: [types/DO.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L183)

#### Parameters

##### config

[`DOConfig`](DOConfig.md)

#### Returns

[`RpcPromise`](RpcPromise.md)\<`void`\>

***

### promoteCollection()

> **promoteCollection**(`noun`): [`RpcPromise`](RpcPromise.md)\<`DO`\>

Defined in: [types/DO.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L189)

#### Parameters

##### noun

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`DO`\>

***

### promoteThing()

> **promoteThing**(`url`): [`RpcPromise`](RpcPromise.md)\<`DO`\>

Defined in: [types/DO.ts:186](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L186)

#### Parameters

##### url

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`DO`\>

***

### resolve()

> **resolve**(`url`): [`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

Defined in: [types/DO.ts:176](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L176)

#### Parameters

##### url

`string`

#### Returns

[`RpcPromise`](RpcPromise.md)\<[`Thing`](Thing.md)\>

## Properties

### $

> `readonly` **$**: [`WorkflowContext`](WorkflowContext.md)

Defined in: [types/DO.ts:169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L169)

***

### actions

> `readonly` **actions**: [`ActionsTable`](ActionsTable.md)

Defined in: [types/DO.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L120)

***

### ai

> **ai**: [`AIFunction`](../type-aliases/AIFunction.md)

Defined in: [types/DO.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L140)

***

### approve

> **approve**: [`ApproveFunction`](../type-aliases/ApproveFunction.md)

Defined in: [types/DO.ts:154](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L154)

***

### ask

> **ask**: [`AskFunction`](../type-aliases/AskFunction.md)

Defined in: [types/DO.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L153)

***

### browse

> **browse**: [`BrowseFunction`](../type-aliases/BrowseFunction.md)

Defined in: [types/DO.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L160)

***

### code

> **code**: [`CodeFunction`](../type-aliases/CodeFunction.md)

Defined in: [types/DO.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L145)

***

### decide

> **decide**: [`DecideFn`](../type-aliases/DecideFn.md)

Defined in: [types/DO.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L150)

***

### diagram

> **diagram**: [`DiagramFunction`](../type-aliases/DiagramFunction.md)

Defined in: [types/DO.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L146)

***

### evaluate

> **evaluate**: [`EvaluateFunction`](../type-aliases/EvaluateFunction.md)

Defined in: [types/DO.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L163)

***

### events

> `readonly` **events**: [`EventsTable`](EventsTable.md)

Defined in: [types/DO.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L121)

***

### extract

> **extract**: [`ExtractFunction`](../type-aliases/ExtractFunction.md)

Defined in: [types/DO.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L144)

***

### is

> **is**: [`IsFunction`](../type-aliases/IsFunction.md)

Defined in: [types/DO.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L149)

***

### list

> **list**: [`ListFunction`](../type-aliases/ListFunction.md)

Defined in: [types/DO.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L143)

***

### nouns

> `readonly` **nouns**: [`NounsRegistry`](NounsRegistry.md)

Defined in: [types/DO.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L115)

***

### ns

> `readonly` **ns**: `string`

Defined in: [types/DO.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L106)

***

### objects

> `readonly` **objects**: [`ObjectsTable`](ObjectsTable.md)

Defined in: [types/DO.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L119)

***

### read

> **read**: [`ReadFunction`](../type-aliases/ReadFunction.md)

Defined in: [types/DO.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L159)

***

### relationships

> `readonly` **relationships**: [`RelationshipsTable`](RelationshipsTable.md)

Defined in: [types/DO.ts:118](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L118)

***

### research

> **research**: [`ResearchFunction`](../type-aliases/ResearchFunction.md)

Defined in: [types/DO.ts:158](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L158)

***

### review

> **review**: [`ReviewFunction`](../type-aliases/ReviewFunction.md)

Defined in: [types/DO.ts:155](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L155)

***

### search

> `readonly` **search**: [`SearchTable`](SearchTable.md)

Defined in: [types/DO.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L122)

***

### summarize

> **summarize**: [`SummarizeFunction`](../type-aliases/SummarizeFunction.md)

Defined in: [types/DO.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L142)

***

### things

> `readonly` **things**: [`ThingsTable`](ThingsTable.md)

Defined in: [types/DO.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L117)

***

### verbs

> `readonly` **verbs**: [`VerbsRegistry`](VerbsRegistry.md)

Defined in: [types/DO.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L116)

***

### write

> **write**: [`WriteFunction`](../type-aliases/WriteFunction.md)

Defined in: [types/DO.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L141)
