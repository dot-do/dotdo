[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createTypedTemplateLiteral

# Function: createTypedTemplateLiteral()

> **createTypedTemplateLiteral**\<`T`\>(`executeFn`, `schema`, `options`): `TypedTemplateLiteral`\<`T`\>

Defined in: [agents/typed-result.ts:439](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L439)

Create a typed template literal function

## Type Parameters

### T

`T`

## Parameters

### executeFn

(`strings`, ...`values`) => `Promise`\<`string`\>

Raw agent execution function

### schema

`ZodType`\<`T`\>

Zod schema for output validation

### options

Additional options

#### agent?

`string`

#### coerce?

`boolean`

## Returns

`TypedTemplateLiteral`\<`T`\>

Typed template literal function

## Example

```typescript
const typedPriya = createTypedTemplateLiteral(
  priya,
  SpecSchema,
  { agent: 'priya' }
)

const spec = await typedPriya`define MVP for ${hypothesis}`
// spec.content.features is string[]
```
