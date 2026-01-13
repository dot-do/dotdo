[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / NamedAgent

# Interface: NamedAgent()

Defined in: [agents/named/factory.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L152)

Named agent that can be invoked via template literal or function call

## Call Signature

> **NamedAgent**(`strings`, ...`values`): `PipelinePromise`\<`string` \| `AgentResultWithTools`\>

Defined in: [agents/named/factory.ts:154](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L154)

Template literal invocation

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

`PipelinePromise`\<`string` \| `AgentResultWithTools`\>

## Call Signature

> **NamedAgent**(`input`): `PipelinePromise`\<`string` \| `AgentResultWithTools`\>

Defined in: [agents/named/factory.ts:156](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L156)

Function call invocation (alternative syntax)

### Parameters

#### input

`string` | `object`

### Returns

`PipelinePromise`\<`string` \| `AgentResultWithTools`\>

## Methods

### approve()?

> `optional` **approve**(`input`): `Promise`\<\{ `approved`: `boolean`; `feedback?`: `string`; \}\>

Defined in: [agents/named/factory.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L180)

Approval method (for reviewers like Tom, Quinn)

#### Parameters

##### input

`unknown`

#### Returns

`Promise`\<\{ `approved`: `boolean`; `feedback?`: `string`; \}\>

***

### as()

> **as**\<`T`\>(`schema`, `options?`): [`TypedTemplateLiteral`](TypedTemplateLiteral.md)\<`T`\>

Defined in: [agents/named/factory.ts:209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L209)

Create a typed template literal that returns AgentResult<T>

#### Type Parameters

##### T

`T`

The expected structured output type

#### Parameters

##### schema

`ZodType`\<`T`\>

Zod schema for output validation

##### options?

[`TypedInvokeOptions`](TypedInvokeOptions.md)

Optional configuration for typed invocation

#### Returns

[`TypedTemplateLiteral`](TypedTemplateLiteral.md)\<`T`\>

Typed template literal function

#### Example

```typescript
const SpecSchema = z.object({
  features: z.array(z.string()),
  timeline: z.string(),
  cost: z.number(),
})

const spec = await priya.as(SpecSchema)`define MVP for ${hypothesis}`
// spec.content.features is string[]
// spec.content.cost is number
```

***

### invoke()

> **invoke**\<`T`\>(`schema`, `prompt`, `options?`): `Promise`\<[`TypedAgentResult`](TypedAgentResult.md)\<`T`\>\>

Defined in: [agents/named/factory.ts:226](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L226)

Invoke agent with typed result

#### Type Parameters

##### T

`T`

The expected structured output type

#### Parameters

##### schema

`ZodType`\<`T`\>

Zod schema for output validation

##### prompt

`string`

The prompt string

##### options?

[`TypedInvokeOptions`](TypedInvokeOptions.md)

Optional configuration

#### Returns

`Promise`\<[`TypedAgentResult`](TypedAgentResult.md)\<`T`\>\>

Promise<AgentResult<T>>

#### Example

```typescript
const spec = await priya.invoke(SpecSchema, 'define MVP for our product')
// spec.content.features is string[]
```

***

### reset()

> **reset**(): `void`

Defined in: [agents/named/factory.ts:174](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L174)

Reset agent context/state

#### Returns

`void`

***

### withConfig()

> **withConfig**(`config`): `NamedAgent`

Defined in: [agents/named/factory.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L171)

Create agent with custom config

#### Parameters

##### config

`AgentConfig`

#### Returns

`NamedAgent`

***

### withProvider()

> **withProvider**(`provider`): `NamedAgent`

Defined in: [agents/named/factory.ts:186](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L186)

Create agent with a different provider

#### Parameters

##### provider

[`AgentProvider`](AgentProvider.md)

#### Returns

`NamedAgent`

## Properties

### description

> `readonly` **description**: `string`

Defined in: [agents/named/factory.ts:165](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L165)

Agent description

***

### name

> `readonly` **name**: `string`

Defined in: [agents/named/factory.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L162)

Agent name

***

### provider?

> `optional` **provider**: [`AgentProvider`](AgentProvider.md)

Defined in: [agents/named/factory.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L183)

The provider used by this agent (if configured)

***

### role

> `readonly` **role**: [`AgentRole`](../type-aliases/AgentRole.md)

Defined in: [agents/named/factory.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L159)

Agent role identifier

***

### stream

> **stream**: `StreamTemplate`

Defined in: [agents/named/factory.ts:177](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L177)

Stream template literal for long responses

***

### tools

> `readonly` **tools**: `AgentTool`[]

Defined in: [agents/named/factory.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L168)

Available tools for this agent
