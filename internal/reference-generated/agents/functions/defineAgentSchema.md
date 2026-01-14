[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / defineAgentSchema

# Function: defineAgentSchema()

> **defineAgentSchema**\<`T`\>(`agent`, `task`, `schema`): `void`

Defined in: [agents/typed-result.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L168)

Define a schema for a specific agent.task combination

This registers the schema both for runtime validation and enables
TypeScript type inference via module augmentation.

## Type Parameters

### T

`T`

## Parameters

### agent

`string`

Agent name (e.g., 'priya', 'ralph')

### task

`string`

Task identifier (e.g., 'define-mvp', 'review')

### schema

`ZodType`\<`T`\>

Zod schema for validation

## Returns

`void`

## Example

```typescript
const SpecSchema = z.object({
  features: z.array(z.string()),
  timeline: z.string(),
  cost: z.number(),
})

defineAgentSchema('priya', 'define-mvp', SpecSchema)
```
