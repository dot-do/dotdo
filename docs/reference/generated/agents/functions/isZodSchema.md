[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / isZodSchema

# Function: isZodSchema()

> **isZodSchema**(`schema`): `schema is ZodType<unknown, unknown, $ZodTypeInternals<unknown, unknown>>`

Defined in: [agents/schema.ts:32](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/schema.ts#L32)

Check if a value is a Zod schema

## Parameters

### schema

`unknown`

The value to check

## Returns

`schema is ZodType<unknown, unknown, $ZodTypeInternals<unknown, unknown>>`

True if the value is a Zod schema instance

## Example

```ts
const zodSchema = z.string()
const jsonSchema = { type: 'string' }

isZodSchema(zodSchema) // true
isZodSchema(jsonSchema) // false
```
