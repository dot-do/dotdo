[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventSchema

# Variable: EventSchema

> `const` **EventSchema**: `ZodObject`\<\{ `actor`: `ZodString`; `branch`: `ZodOptional`\<`ZodString`\>; `cascade`: `ZodOptional`\<`ZodObject`\<\{ `attempts`: `ZodArray`\<`ZodObject`\<\{ `failed`: `ZodBoolean`; `method`: `ZodEnum`\<\{ `agentic`: `"agentic"`; `code`: `"code"`; `generative`: `"generative"`; `human`: `"human"`; \}\>; `reason`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>\>; \}, `$strip`\>\>; `channel`: `ZodOptional`\<`ZodString`\>; `context`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`\>\>; `destination`: `ZodOptional`\<`ZodString`\>; `disposition`: `ZodOptional`\<`ZodString`\>; `location`: `ZodOptional`\<`ZodString`\>; `method`: `ZodOptional`\<`ZodEnum`\<\{ `agentic`: `"agentic"`; `code`: `"code"`; `generative`: `"generative"`; `human`: `"human"`; \}\>\>; `model`: `ZodOptional`\<`ZodString`\>; `ns`: `ZodString`; `object`: `ZodString`; `quantity`: `ZodOptional`\<`ZodNumber`\>; `readPoint`: `ZodOptional`\<`ZodString`\>; `reason`: `ZodOptional`\<`ZodString`\>; `recorded`: `ZodOptional`\<`ZodPipe`\<`ZodUnion`\<readonly \[`ZodDate`, `ZodString`\]\>, `ZodTransform`\<`Date`, `string` \| `Date`\>\>\>; `source`: `ZodOptional`\<`ZodString`\>; `timestamp`: `ZodOptional`\<`ZodPipe`\<`ZodUnion`\<readonly \[`ZodDate`, `ZodString`\]\>, `ZodTransform`\<`Date`, `string` \| `Date`\>\>\>; `tools`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `transaction`: `ZodOptional`\<`ZodString`\>; `type`: `ZodString`; `verb`: `ZodString`; \}, `$strip`\>

Defined in: [types/event.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L353)

EventSchema - Zod schema for runtime validation
