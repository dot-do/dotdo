[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createStructuredOutputParser

# Function: createStructuredOutputParser()

> **createStructuredOutputParser**\<`T`, `TOutput`\>(`schema`, `options`): (`output`) => `Promise`\<`TOutput`\>

Defined in: [agents/structured-output.ts:489](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L489)

Create a structured output parser with retry logic

## Type Parameters

### T

`T`

### TOutput

`TOutput` = `T`

## Parameters

### schema

`ZodType`\<`T`\>

Zod schema to validate against

### options

[`StructuredOutputOptions`](../interfaces/StructuredOutputOptions.md)\<`T`\> = `{}`

Parser options including retry configuration

## Returns

Async parser function

> (`output`): `Promise`\<`TOutput`\>

### Parameters

#### output

`unknown`

### Returns

`Promise`\<`TOutput`\>

## Example

```ts
const parser = createStructuredOutputParser(reviewSchema, {
  coerce: true,
  maxRetries: 2,
  onError: async (error) => {
    // Ask AI to fix the malformed output
    return await askAI(`Fix this JSON: ${error.rawOutput}\nError: ${error.message}`)
  },
})

const result = await parser(aiResponse)
```
