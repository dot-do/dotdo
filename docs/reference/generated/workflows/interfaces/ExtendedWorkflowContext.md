[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ExtendedWorkflowContext

# Interface: ExtendedWorkflowContext

Defined in: [workflows/workflow.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/workflow.ts#L23)

Extended workflow context with additional helpers

## Extends

- [`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

## Methods

### branch()

> **branch**(`name`): `Promise`\<`void`\>

Defined in: [types/WorkflowContext.ts:417](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L417)

Create a new branch at current HEAD

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`branch`](../../types/interfaces/WorkflowContext.md#branch)

***

### checkout()

> **checkout**(`ref`): `Promise`\<`void`\>

Defined in: [types/WorkflowContext.ts:424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L424)

Switch to a branch or version
$.checkout('experiment')
$.checkout('@v1234')

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`checkout`](../../types/interfaces/WorkflowContext.md#checkout)

***

### do()

> **do**\<`T`\>(`action`, `data`, `options?`): `Promise`\<`T`\>

Defined in: [types/WorkflowContext.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L329)

Durable execution with retries
Blocking, durable, guaranteed event emission

Features:
- Configurable retry policy with exponential backoff
- Step persistence for replay
- Complete action lifecycle tracking

#### Type Parameters

##### T

`T`

#### Parameters

##### action

`string`

The action to execute

##### data

`unknown`

The data to pass to the action

##### options?

[`DoOptions`](../../types/interfaces/DoOptions.md)

Optional execution options (retry, timeout, stepId) - DO-specific extension

#### Returns

`Promise`\<`T`\>

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`do`](../../types/interfaces/WorkflowContext.md#do)

***

### log()

> **log**(`message`, `data?`): `void`

Defined in: [types/WorkflowContext.ts:438](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L438)

Structured logging with automatic history tracking

#### Parameters

##### message

`string`

##### data?

`unknown`

#### Returns

`void`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`log`](../../types/interfaces/WorkflowContext.md#log)

***

### merge()

> **merge**(`branch`): `Promise`\<`void`\>

Defined in: [types/WorkflowContext.ts:429](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L429)

Merge a branch into current

#### Parameters

##### branch

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`merge`](../../types/interfaces/WorkflowContext.md#merge)

***

### try()

> **try**\<`T`\>(`action`, `data`, `options?`): `Promise`\<`T`\>

Defined in: [types/WorkflowContext.ts:314](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L314)

Quick attempt without durability
Blocking, non-durable, single attempt

#### Type Parameters

##### T

`T`

#### Parameters

##### action

`string`

The action to execute

##### data

`unknown`

The data to pass to the action

##### options?

[`TryOptions`](../../types/interfaces/TryOptions.md)

Optional execution options (timeout) - DO-specific extension

#### Returns

`Promise`\<`T`\>

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`try`](../../types/interfaces/WorkflowContext.md#try)

***

### when()

> **when**\<`T`, `F`\>(`condition`, `branches`): `T` \| `F`

Defined in: [workflows/workflow.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/workflow.ts#L27)

Conditional execution

#### Type Parameters

##### T

`T`

##### F

`F`

#### Parameters

##### condition

`unknown`

##### branches

###### else

() => `F`

###### then

() => `T`

#### Returns

`T` \| `F`

## Properties

### ai

> **ai**: [`AITemplateLiteralFn`](../../types/type-aliases/AITemplateLiteralFn.md)\<`string`\>

Defined in: [types/WorkflowContext.ts:362](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L362)

General AI completion as template literal
$.ai`What is the capital of France?`
$.ai`Explain ${topic} in simple terms`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`ai`](../../types/interfaces/WorkflowContext.md#ai)

***

### Customer()

> **Customer**: (`id`) => [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L119)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`NounRegistry`](../../types/interfaces/NounRegistry.md).[`Customer`](../../types/interfaces/NounRegistry.md#customer)

***

### decide

> **decide**: [`DecideFn`](../../types/type-aliases/DecideFn.md)

Defined in: [types/WorkflowContext.ts:399](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L399)

Multi-option classification factory
const sentiment = $.decide(['positive', 'negative', 'neutral'])
const result = await sentiment`What is the sentiment? ${text}`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`decide`](../../types/interfaces/WorkflowContext.md#decide)

***

### every

> **every**: [`ScheduleBuilder`](../../types/interfaces/ScheduleBuilder.md)

Defined in: [types/WorkflowContext.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L351)

Schedule recurring tasks
$.every.Monday.at9am(handler)
$.every('daily at 6am', handler)

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`every`](../../types/interfaces/WorkflowContext.md#every)

***

### extract()

> **extract**: \<`T`\>(`strings`, ...`values`) => [`AIPipelinePromise`](../../types/interfaces/AIPipelinePromise.md)\<[`ExtractResult`](../../types/interfaces/ExtractResult.md)\<`T`\>\>

Defined in: [types/WorkflowContext.ts:386](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L386)

Data extraction
const { entities } = await $.extract`Extract companies from: ${article}`

#### Type Parameters

##### T

`T` = `Record`\<`string`, `unknown`\>

#### Parameters

##### strings

`TemplateStringsArray`

##### values

...`unknown`[]

#### Returns

[`AIPipelinePromise`](../../types/interfaces/AIPipelinePromise.md)\<[`ExtractResult`](../../types/interfaces/ExtractResult.md)\<`T`\>\>

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`extract`](../../types/interfaces/WorkflowContext.md#extract)

***

### Invoice()

> **Invoice**: (`id`) => [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L120)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`NounRegistry`](../../types/interfaces/NounRegistry.md).[`Invoice`](../../types/interfaces/NounRegistry.md#invoice)

***

### is

> **is**: [`AITemplateLiteralFn`](../../types/type-aliases/AITemplateLiteralFn.md)\<`boolean`\>

Defined in: [types/WorkflowContext.ts:392](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L392)

Binary classification
const isSpam = await $.is`Is this message spam? ${message}`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`is`](../../types/interfaces/WorkflowContext.md#is)

***

### list

> **list**: [`AITemplateLiteralFn`](../../types/type-aliases/AITemplateLiteralFn.md)\<`string`[]\>

Defined in: [types/WorkflowContext.ts:380](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L380)

List generation
const items = await $.list`List 5 programming languages`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`list`](../../types/interfaces/WorkflowContext.md#list)

***

### on

> **on**: [`OnProxy`](../../types/interfaces/OnProxy.md)

Defined in: [types/WorkflowContext.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L340)

Subscribe to domain events
$.on.Customer.created(handler)
$.on.Invoice.paid(handler)

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`on`](../../types/interfaces/WorkflowContext.md#on)

***

### Order()

> **Order**: (`id`) => [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L121)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`NounRegistry`](../../types/interfaces/NounRegistry.md).[`Order`](../../types/interfaces/NounRegistry.md#order)

***

### Payment()

> **Payment**: (`id`) => [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L122)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`NounRegistry`](../../types/interfaces/NounRegistry.md).[`Payment`](../../types/interfaces/NounRegistry.md#payment)

***

### send()

> **send**: \<`T`\>(`event`, `data`) => `string`

Defined in: [types/WorkflowContext.ts:304](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L304)

Send an event (durable)
Guaranteed delivery with retries, returns trackable EventId
Use for important domain events that must not be lost

Inherited from WorkflowContextType, returns EventId (string)

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### event

`string`

##### data

`T`

#### Returns

`string`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`send`](../../types/interfaces/WorkflowContext.md#send)

***

### Startup()

> **Startup**: (`id`) => [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L123)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`NounRegistry`](../../types/interfaces/NounRegistry.md).[`Startup`](../../types/interfaces/NounRegistry.md#startup)

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Defined in: [types/WorkflowContext.ts:443](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L443)

Current workflow state

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`state`](../../types/interfaces/WorkflowContext.md#state)

***

### summarize

> **summarize**: [`AITemplateLiteralFn`](../../types/type-aliases/AITemplateLiteralFn.md)\<`string`\>

Defined in: [types/WorkflowContext.ts:374](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L374)

Summarization
const summary = await $.summarize`${longArticle}`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`summarize`](../../types/interfaces/WorkflowContext.md#summarize)

***

### track()

> **track**: (`event`, `data`) => `void`

Defined in: [types/WorkflowContext.ts:295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L295)

Track an event (fire and forget)
Best effort, no confirmation, swallows errors silently
Use for telemetry, analytics, non-critical logging

Inherited from WorkflowContextType

#### Parameters

##### event

`string`

##### data

`unknown`

#### Returns

`void`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`track`](../../types/interfaces/WorkflowContext.md#track)

***

### user

> **user**: [`UserContext`](../../types/interfaces/UserContext.md) \| `null`

Defined in: [types/WorkflowContext.ts:466](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L466)

Current authenticated user context.
Extracted from X-User-* headers on each incoming request.
Set by the RPC auth middleware before forwarding to the DO.

- `null` if the request is unauthenticated (no X-User-ID header)
- Contains `id`, optional `email`, and optional `role`

#### Example

```typescript
$.on.Customer.created(async (event) => {
  if ($.user) {
    console.log(`Event triggered by: ${$.user.id}`)
  }
})
```

#### Inherited from

`ExtendedWorkflowContext`.[`user`](#user)

***

### User()

> **User**: (`id`) => [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L124)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`NounRegistry`](../../types/interfaces/NounRegistry.md).[`User`](../../types/interfaces/NounRegistry.md#user)

***

### write

> **write**: [`AITemplateLiteralFn`](../../types/type-aliases/AITemplateLiteralFn.md)\<[`WriteResult`](../../types/interfaces/WriteResult.md)\>

Defined in: [types/WorkflowContext.ts:368](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L368)

Text generation with structured output
const { title, body } = await $.write`Write a blog post about ${topic}`

#### Inherited from

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md).[`write`](../../types/interfaces/WorkflowContext.md#write)
