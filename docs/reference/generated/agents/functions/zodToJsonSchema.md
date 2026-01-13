[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / zodToJsonSchema

# Function: zodToJsonSchema()

> **zodToJsonSchema**(`schema`): [`JsonSchema`](../interfaces/JsonSchema.md)

Defined in: [agents/schema.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L92)

Convert a Zod schema to JSON Schema format

Supports common Zod types:
- Primitives: string, number, boolean
- Arrays: z.array()
- Objects: z.object()
- Enums: z.enum()
- Optionals: z.optional(), z.nullable()
- Defaults: z.default()

## Parameters

### schema

`ZodType`\<`unknown`\>

The Zod schema to convert

## Returns

[`JsonSchema`](../interfaces/JsonSchema.md)

JSON Schema representation

## Example

```ts
const zodSchema = z.object({
  name: z.string().describe('User name'),
  age: z.number().optional(),
})

const jsonSchema = zodToJsonSchema(zodSchema)
// {
//   type: 'object',
//   properties: {
//     name: { type: 'string', description: 'User name' },
//     age: { type: 'number' }
//   },
//   required: ['name']
// }
```
