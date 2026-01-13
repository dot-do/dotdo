[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createTypedInvoke

# Function: createTypedInvoke()

> **createTypedInvoke**(`agentName`, `executeFn`): \<`T`\>(`schema`, `prompt`) => `Promise`\<[`TypedAgentResult`](../interfaces/TypedAgentResult.md)\<`T`\>\>

Defined in: [agents/typed-result.ts:370](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L370)

Create a typed invocation function for an agent

## Parameters

### agentName

`string`

Name of the agent

### executeFn

(`prompt`) => `Promise`\<`string`\>

Function that executes the agent and returns raw text

## Returns

Typed invoke function

> \<`T`\>(`schema`, `prompt`): `Promise`\<[`TypedAgentResult`](../interfaces/TypedAgentResult.md)\<`T`\>\>

### Type Parameters

#### T

`T`

### Parameters

#### schema

`ZodType`\<`T`\>

#### prompt

`string`

### Returns

`Promise`\<[`TypedAgentResult`](../interfaces/TypedAgentResult.md)\<`T`\>\>

## Example

```typescript
const invokeTyped = createTypedInvoke('priya', async (prompt) => {
  return await priya(prompt)
})

const spec = await invokeTyped(SpecSchema, 'define the MVP')
// spec.content.features is string[]
```
