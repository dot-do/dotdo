[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / WorkflowContext

# Interface: WorkflowContext

Defined in: [types/WorkflowContext.ts:281](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L281)

NounAccessors - Mapped type providing typed noun access

Each key in NounRegistry becomes a callable (id: string) => DomainProxy
property on WorkflowContext.

## Extends

- `Omit`\<`WorkflowContextTypeBase`, `"on"` \| `"every"` \| `"set"` \| `"get"`\>.[`NounAccessors`](../type-aliases/NounAccessors.md)

## Extended by

- [`ExtendedWorkflowContext`](../../workflows/interfaces/ExtendedWorkflowContext.md)

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

[`DoOptions`](DoOptions.md)

Optional execution options (retry, timeout, stepId) - DO-specific extension

#### Returns

`Promise`\<`T`\>

#### Overrides

`Omit.do`

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

[`TryOptions`](TryOptions.md)

Optional execution options (timeout) - DO-specific extension

#### Returns

`Promise`\<`T`\>

#### Overrides

`Omit.try`

## Properties

### ai

> **ai**: [`AITemplateLiteralFn`](../type-aliases/AITemplateLiteralFn.md)\<`string`\>

Defined in: [types/WorkflowContext.ts:362](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L362)

General AI completion as template literal
$.ai`What is the capital of France?`
$.ai`Explain ${topic} in simple terms`

***

### Customer()

> **Customer**: (`id`) => [`DomainProxy`](DomainProxy.md)

Defined in: [types/WorkflowContext.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L119)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](DomainProxy.md)

#### Inherited from

[`NounRegistry`](NounRegistry.md).[`Customer`](NounRegistry.md#customer)

***

### decide

> **decide**: [`DecideFn`](../type-aliases/DecideFn.md)

Defined in: [types/WorkflowContext.ts:399](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L399)

Multi-option classification factory
const sentiment = $.decide(['positive', 'negative', 'neutral'])
const result = await sentiment`What is the sentiment? ${text}`

***

### every

> **every**: [`ScheduleBuilder`](ScheduleBuilder.md)

Defined in: [types/WorkflowContext.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L351)

Schedule recurring tasks
$.every.Monday.at9am(handler)
$.every('daily at 6am', handler)

***

### extract()

> **extract**: \<`T`\>(`strings`, ...`values`) => [`AIPipelinePromise`](AIPipelinePromise.md)\<[`ExtractResult`](ExtractResult.md)\<`T`\>\>

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

[`AIPipelinePromise`](AIPipelinePromise.md)\<[`ExtractResult`](ExtractResult.md)\<`T`\>\>

***

### Invoice()

> **Invoice**: (`id`) => [`DomainProxy`](DomainProxy.md)

Defined in: [types/WorkflowContext.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L120)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](DomainProxy.md)

#### Inherited from

[`NounRegistry`](NounRegistry.md).[`Invoice`](NounRegistry.md#invoice)

***

### is

> **is**: [`AITemplateLiteralFn`](../type-aliases/AITemplateLiteralFn.md)\<`boolean`\>

Defined in: [types/WorkflowContext.ts:392](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L392)

Binary classification
const isSpam = await $.is`Is this message spam? ${message}`

***

### list

> **list**: [`AITemplateLiteralFn`](../type-aliases/AITemplateLiteralFn.md)\<`string`[]\>

Defined in: [types/WorkflowContext.ts:380](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L380)

List generation
const items = await $.list`List 5 programming languages`

***

### on

> **on**: [`OnProxy`](OnProxy.md)

Defined in: [types/WorkflowContext.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L340)

Subscribe to domain events
$.on.Customer.created(handler)
$.on.Invoice.paid(handler)

***

### Order()

> **Order**: (`id`) => [`DomainProxy`](DomainProxy.md)

Defined in: [types/WorkflowContext.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L121)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](DomainProxy.md)

#### Inherited from

[`NounRegistry`](NounRegistry.md).[`Order`](NounRegistry.md#order)

***

### Payment()

> **Payment**: (`id`) => [`DomainProxy`](DomainProxy.md)

Defined in: [types/WorkflowContext.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L122)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](DomainProxy.md)

#### Inherited from

[`NounRegistry`](NounRegistry.md).[`Payment`](NounRegistry.md#payment)

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

#### Overrides

`Omit.send`

***

### Startup()

> **Startup**: (`id`) => [`DomainProxy`](DomainProxy.md)

Defined in: [types/WorkflowContext.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L123)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](DomainProxy.md)

#### Inherited from

[`NounRegistry`](NounRegistry.md).[`Startup`](NounRegistry.md#startup)

***

### state

> **state**: `Record`\<`string`, `unknown`\>

Defined in: [types/WorkflowContext.ts:443](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L443)

Current workflow state

#### Overrides

`Omit.state`

***

### summarize

> **summarize**: [`AITemplateLiteralFn`](../type-aliases/AITemplateLiteralFn.md)\<`string`\>

Defined in: [types/WorkflowContext.ts:374](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L374)

Summarization
const summary = await $.summarize`${longArticle}`

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

#### Overrides

`Omit.track`

***

### user

> **user**: [`UserContext`](UserContext.md) \| `null`

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

***

### User()

> **User**: (`id`) => [`DomainProxy`](DomainProxy.md)

Defined in: [types/WorkflowContext.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L124)

#### Parameters

##### id

`string`

#### Returns

[`DomainProxy`](DomainProxy.md)

#### Inherited from

[`NounRegistry`](NounRegistry.md).[`User`](NounRegistry.md#user)

***

### write

> **write**: [`AITemplateLiteralFn`](../type-aliases/AITemplateLiteralFn.md)\<[`WriteResult`](WriteResult.md)\>

Defined in: [types/WorkflowContext.ts:368](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L368)

Text generation with structured output
const { title, body } = await $.write`Write a blog post about ${topic}`
