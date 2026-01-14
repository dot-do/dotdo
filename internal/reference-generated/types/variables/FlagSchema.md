[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / FlagSchema

# Variable: FlagSchema

> `const` **FlagSchema**: `ZodObject`\<\{ `branches`: `ZodArray`\<`ZodObject`\<\{ `key`: `ZodString`; `payload`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`\>\>; `weight`: `ZodNumber`; \}, `$strict`\>\>; `filters`: `ZodOptional`\<`ZodArray`\<`ZodObject`\<\{ `cohortId`: `ZodOptional`\<`ZodString`\>; `operator`: `ZodOptional`\<`ZodEnum`\<\{ `contains`: `"contains"`; `eq`: `"eq"`; `gt`: `"gt"`; `in`: `"in"`; `lt`: `"lt"`; \}\>\>; `property`: `ZodOptional`\<`ZodString`\>; `type`: `ZodEnum`\<\{ `cohort`: `"cohort"`; `property`: `"property"`; \}\>; `value`: `ZodOptional`\<`ZodUnknown`\>; \}, `$strict`\>\>\>; `id`: `ZodString`; `key`: `ZodString`; `status`: `ZodEnum`\<\{ `active`: `"active"`; `disabled`: `"disabled"`; \}\>; `stickiness`: `ZodEnum`\<\{ `random`: `"random"`; `session_id`: `"session_id"`; `user_id`: `"user_id"`; \}\>; `traffic`: `ZodNumber`; \}, `$strict`\>

Defined in: [types/Flag.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L97)

Zod schema for Flag validation

Validates:
- id and key are strings
- branches is a non-empty array
- traffic is between 0 and 1
- stickiness is one of: user_id, session_id, random
- status is one of: active, disabled
- filters is an optional array of Filter objects
