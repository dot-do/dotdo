[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / validateInput

# Function: validateInput()

> **validateInput**\<`T`\>(`schema`, `input`): [`ValidationResult`](../type-aliases/ValidationResult.md)\<`T`\>

Defined in: [agents/schema.ts:255](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L255)

Validate input against a schema

Supports both Zod schemas and JSON Schema (passthrough for JSON Schema).
Returns a result object with either the validated data or a detailed error.

## Type Parameters

### T

`T`

## Parameters

### schema

[`Schema`](../type-aliases/Schema.md)\<`T`\>

The schema to validate against (Zod or JSON Schema)

### input

`unknown`

The input value to validate

## Returns

[`ValidationResult`](../type-aliases/ValidationResult.md)\<`T`\>

Validation result with typed data or error

## Example

```ts
const schema = z.object({
  name: z.string(),
  age: z.number()
})

const result = validateInput(schema, { name: 'Alice', age: 30 })
if (result.success) {
  console.log(result.data.name) // 'Alice'
} else {
  console.error(result.error.toString())
}
```
